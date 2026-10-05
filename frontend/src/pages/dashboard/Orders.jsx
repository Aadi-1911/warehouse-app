import { useEffect, useState } from 'react';
import { ChevronIcon } from '../../components/icons';
import ConfirmModal from '../../components/ConfirmModal';
import { listOrders, getOrder, billOrder } from '../../api/orders';
import { piecesPerSetFor } from '../../utils/piecesPerSet';
import { computeBillingAmounts, chargedUnitPrice, clampPercent, seenPricesFromPreview, describeChangedLines } from '../../utils/orderBilling';
import BillReviewPanel from '../../components/BillReviewPanel';
import PinPrompt from '../../components/PinPrompt';
import { useFulfillmentPreview } from '../../hooks/useFulfillmentPreview';
import { useOwnerCostPrices } from '../../hooks/useOwnerCostPrices';
import { useAuth } from '../../hooks/useAuth';
import { deriveBillPricing, PIN_ERROR_CODES } from '../../utils/billPriceOverrides';
import { ORDER_STATUS_LABEL, ORDER_STATUS_BADGE, isOpenOrder } from '../../utils/orderStatus';
import { formatMoney } from '../../utils/money';
import { cleanBillNo } from '../../utils/billNo';

// Owner Dashboard — Orders (07_UI_DESIGN_BRIEF.md §8's "Orders page" section).
//
// Accordion, one row per order — GET /api/orders unfiltered (no date/party filter UI; the design
// brief doesn't document one, and inventing one wasn't asked for). That endpoint's totalValue is
// already correct as of the recent pricing-fix tasks (per-piece pricing, cancelled lines
// excluded) — this page trusts it rather than recomputing its own version.
//
// Expanding a row lazily fetches full line detail via GET /api/orders/:id on first expand, cached
// per order afterward — the scalable choice per the task brief, even though current order volume
// (3 rows) would make an upfront fetch-everything approach work just as well today.
//
// "Mark billed" calls the SAME billOrder() the mobile Bill Order screen already uses — no second
// billing code path. That's what makes the History entry it writes (authored as the owner) come
// for free here rather than needing its own implementation.
//
// isCancelled is an ORDER-level flag, independent of status (rule: cancelling never rewrites
// status — see cancelOrder). GET /api/orders' unfiltered response didn't select it until this was
// found and fixed 2026-08-20: a cancelled order at status PACKED rendered identically to an active
// one here, "Mark billed" included, even though billOrder() itself already rejects it server-side
// (409 ORDER_CANCELLED) — confirmed that guard exists before treating this as frontend-only.

// STATUS_LABEL/STATUS_BADGE now live in utils/orderStatus.js — consolidated 2026-08-20 when the
// Parties page became a second dashboard surface needing the identical status→colour mapping.

// Month toggle (added 2026-08-20): the page splits into two sections.
//   1. "Open orders" — PLACED + PACKED, non-cancelled (utils/orderStatus.js's isOpenOrder — see
//      that file's own comment for why this is no longer tied to anything in
//      dashboardController.js). Always shown in full, never month-filtered — an open order
//      doesn't stop being open because its createdAt falls outside whatever month happens to be
//      selected below.
//   2. Everything else — BILLED, SHIPPED, and cancelled orders (any status) — filtered to one
//      selected month at a time via a dropdown, defaulting to the current calendar month.
// These two sets are exhaustive and non-overlapping by construction: rule 23 only allows
// isCancelled to be set while PLACED or PACKED, so a BILLED/SHIPPED order can never be cancelled,
// and isOpenOrder's own !isCancelled check means a cancelled PLACED/PACKED order falls out of
// section 1 and into section 2 instead of vanishing.
//
// Bucketing date per order (04_API_SPEC.md's own convention for status-scoped lists — "the date
// an order entered its current stage"):
//   - BILLED (not yet shipped): billedAt.
//   - SHIPPED: shippedAt.
//   - Cancelled: cancelledAt (server-resolved — see orderController.js's listOrders comment on
//     the adjustments select). Investigated before using this: a cancelled order may have been
//     cancelled straight from PLACED, with no packedAt/billedAt/shippedAt at all, so those can't
//     reliably date it. cancelOrder/cancelOrderLine both already write a real, timestamped
//     OrderAdjustment row for the cancellation event — reading that turned out to be a small
//     addition (one more nested Prisma select, not a new endpoint or schema change), so this uses
//     the real date rather than settling for an approximation.

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthKeyOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelOf(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

// The one date that actually matters for THIS order — whichever stage/event most recently placed
// it where it is. Section 1 (open orders) always uses createdAt instead (there's no stage-date to
// speak of yet), handled directly at the call site rather than here.
function bucketDateOf(order) {
  if (order.isCancelled) return order.cancelledAt;
  if (order.status === 'SHIPPED') return order.shippedAt;
  return order.billedAt; // BILLED — the only other status section 2 ever contains
}

// T1 (2026-09-30): was a local formatCurrency() here, byte-identical to the one
// BillOrderDetail.jsx had of its own — now utils/money.js's shared formatMoney(), imported and
// used directly wherever this screen used it for a PRICE (list-row/line/article-group totals, the
// price review inputs via BillPriceReview's own `formatCurrency` prop, Total to bill/Amount
// billed). This screen also needs the OTHER mode — formatPaise below — for the post-billing Pre-tax
// total/Discount/GST breakdown, which must always show exactly 2 decimals; see money.js's own header
// comment for why the two modes exist. (The live discount/GST/Order-total lines in the Mark-billed
// dialog used this too until T6b, 2026-10-05; BillReviewPanel.jsx renders those now, with its own
// identical copy.)
function formatPaise(amount) {
  return formatMoney(amount, { mode: 'paise' });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

// Which quantity a line's VALUE is computed from depends on how far the order has got, and this is
// the ONE place that decides it (lineValue and the group totals both go through it).
//   - PLACED / PACKED: qtySetsRequested. Nothing has been charged yet, and this matches the
//     collapsed row, whose figure (GET /api/orders' totalValue, orderController.js listOrders) falls
//     back to qtySetsRequested × piecesPerSet × priceAtOrder while the order has no billing
//     snapshot.
//   - BILLED / SHIPPED: qtySetsPacked. billOrder() charges qtySetsPacked × piecesPerSet ×
//     billedUnitPrice (utils/locationPricing.js computeBilledLines), and the collapsed row now shows
//     actualPayable, which is built from that same pre-tax figure — so requested-based lines on a
//     short-packed billed order (say 3 sets requested, 2 packed) would overstate the value and
//     disagree with the "Pre-tax total" footer below them. An earlier version of this comment claimed
//     the requested basis was right for every status; that only held for unbilled orders.
// Decided from the order's STATUS rather than billedAt: status is already loaded with the order and
// is what the rest of this row branches on (the "Not yet packed" text below), and billedAt is set by
// the very same PACKED -> BILLED transition, so the two cannot disagree — status is just the one
// this screen already reads.
const BILLED_ORDER_STATUSES = ['BILLED', 'SHIPPED'];
function valuedQtySets(li, orderStatus) {
  return BILLED_ORDER_STATUSES.includes(orderStatus) ? li.qtySetsPacked : li.qtySetsRequested;
}

// A line's value = the chosen quantity (valuedQtySets) × pieces per set × the unit price actually
// charged. A cancelled line is worth 0 on every status.
//
// The PRICE is chargedUnitPrice(li), not priceAtOrder: this expanded view is shown for orders of
// EVERY status, including BILLED/SHIPPED, and on those the quote (priceAtOrder) can differ from
// what the bill actually charged (a location price or an at-billing override, rules 111/113). For
// a PLACED/PACKED order billedUnitPrice is null so this is the quote, exactly as before.
function lineValue(li, orderStatus) {
  if (li.isCancelled) return 0;
  return valuedQtySets(li, orderStatus) * piecesPerSetFor({ isKids: li.productIsKids, sizes: li.productSizes }) * Number(chargedUnitPrice(li));
}

// Groups an order's lines by Article, Colour lines nested inside — same shape BillOrderDetail.jsx
// already builds for the identical order data (grouped-by-productId, sorted by article number).
// Pure grouping — every number here is lineValue() summed, so the order's real
// preTaxAmount/actualPayable footer (computed server-side, read from detail.order directly) is
// completely unaffected by how these lines are arranged on screen. `orderStatus` is passed through
// to lineValue so the group totals use the same quantity basis as the lines inside them.
function buildArticleGroups(lineItems, orderStatus) {
  return lineItems
    .reduce((acc, li) => {
      let group = acc.find((g) => g.productId === li.productId);
      if (!group) {
        group = { productId: li.productId, articleNo: li.productArticleNo, productName: li.productName, lines: [], total: 0 };
        acc.push(group);
      }
      group.lines.push(li);
      group.total += lineValue(li, orderStatus);
      return acc;
    }, [])
    .sort((a, b) => a.articleNo.localeCompare(b.articleNo));
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [ordersStatus, setOrdersStatus] = useState('idle');
  const [ordersError, setOrdersError] = useState(null);

  // Multiple rows can be open at once — same convention PackOrderDetail/BillOrderDetail use for
  // their own article accordions (a Set of expanded ids, not one active id).
  const [expanded, setExpanded] = useState(() => new Set());

  // Article-level accordion state for an EXPANDED order's own line-item grouping (added
  // 2026-08-26). Keyed by `${orderId}:${productId}` rather than a per-order nested Set, because
  // this is still just one flat collection of independently-toggleable sections — the same shape
  // every other Set-of-ids accordion state in this app already uses, just with a composite key
  // since two different orders can each have an article sharing the same productId.
  const [expandedArticles, setExpandedArticles] = useState(() => new Set());

  // Per-order cache of the lazily-fetched detail: { [orderId]: { status: 'loading'|'loaded'|'error', order, error } }.
  const [details, setDetails] = useState({});

  const [billTarget, setBillTarget] = useState(null); // the order row being billed, or null
  const [billing, setBilling] = useState(false);
  const [billError, setBillError] = useState(null);

  // Discount/GST questions (added 2026-08-25, rule 101) — same shape and same shared
  // computeBillingAmounts (utils/orderBilling.js) as BillOrderDetail.jsx, so this screen's live
  // preview can never disagree with mobile's for the identical order. The pre-tax figure it's
  // applied on top of now comes from useFulfillmentPreview on both screens (rule 113), not from a
  // client-side sum of priceAtOrder (the quote) — billing charges billedUnitPrice, which can differ.
  const [discountApplicable, setDiscountApplicable] = useState(false);
  const [discountPercent, setDiscountPercent] = useState('');
  const [gstApplicable, setGstApplicable] = useState(false);
  const [gstPercent, setGstPercent] = useState('');
  // Optional Bill No. (T6b, 2026-10-05, Owner decision Q7) — the same optional reference tag mobile's
  // BillOrderDetail.jsx has captured since 2026-08-30, so both billing screens can record it. Feeds
  // none of the amount arithmetic and never blocks billing (billingInputIncomplete ignores it).
  // Reset on open, on cancel and on success, NOT only on cancel like discount/GST: mobile gets a
  // fresh value after billing for free because it navigates away, but this page stays mounted and
  // lists many orders, so without the success/open resets one order's bill number would be sitting
  // in the box when "Mark billed" opens on the next.
  const [billNo, setBillNo] = useState('');
  // Fulfilment location (2026-09-07) — REQUIRED by the server on every bill, same as mobile's
  // BillOrderDetail. Null until BillFulfillmentPicker resolves the real GGN id from the API, so
  // no location id is hardcoded on this screen either.
  const [fulfillLocationId, setFulfillLocationId] = useState(null);
  const [locationConfirmed, setLocationConfirmed] = useState(false);

  // The SAME preview BillFulfillmentPicker shows, fetched once here rather than a second time
  // inside it — see that component's header comment and useFulfillmentPreview's own. Keyed on
  // `billTarget?.id`: there is only ever one order being billed at a time on this page (a list of
  // many rows, one active confirm modal), so this doesn't need to be per-row state. `null` when no
  // order is targeted, which the hook treats the same as "nothing to fetch yet".
  const { status: previewStatus, preview, error: previewError, refetch: refetchPreview } = useFulfillmentPreview(
    billTarget?.id ?? null,
    fulfillLocationId
  );

  // At-billing price overrides (rule 113) — same five pieces of state, same meanings, as
  // BillOrderDetail.jsx's. Raw typed strings keyed by productId so a half-typed value round-trips
  // unchanged; pinStaged is the owner's progress through the two-step confirm; the two notes are
  // "look again" messages that belong inside the modal rather than in the page banner behind it.
  const [priceOverrides, setPriceOverrides] = useState({});
  const [pinStaged, setPinStaged] = useState(false);
  const [priceResetNote, setPriceResetNote] = useState(null);
  const [staleNote, setStaleNote] = useState(null);

  // Cost prices for the below-cost warning. The whole /dashboard tree is OWNER-only at the route, so
  // this is always an owner fetch — the flag is belt-and-braces over GET /api/products' own role
  // gate (productController.js's productSelect(role)), which is what actually keeps cost from STAFF.
  const { user } = useAuth();
  const { status: costStatus, costPriceByProductId, error: costError } = useOwnerCostPrices(user.role === 'OWNER');

  // THE one derivation, shared with BillOrderDetail.jsx (utils/billPriceOverrides.js) so the two
  // billing screens cannot disagree about the same order. The line items come from this page's own
  // lazily-fetched detail cache, and only for the estimated total (the preview carries no
  // piecesPerSet shape) — `?? null` covers the window where "Mark billed" has opened the modal but
  // ensureDetail's fetch hasn't landed, which deriveBillPricing answers with a null estimate rather
  // than a sum missing an article.
  const pricing = deriveBillPricing({
    preview,
    lineItems: billTarget ? (details[billTarget.id]?.order?.lineItems ?? null) : null,
    overrides: priceOverrides,
    costPriceByProductId,
  });

  // Typing a price invalidates the PIN step — the PIN is about a specific set of numbers, so
  // changing them has to send the owner back to review rather than leave a PIN field under a figure
  // it no longer matches.
  function handleOverrideChange(productId, value) {
    setPriceOverrides((prev) => ({ ...prev, [productId]: value }));
    setPinStaged(false);
    setPriceResetNote(null);
    setStaleNote(null);
  }

  // A real location SWITCH only — fired from BillFulfillmentPicker's single tap branch, never from
  // its default-location pick and never from a preview re-fetch. A price approved against Gurgaon's
  // baseline is a different decision against Delhi's, so it cannot survive the switch.
  function handleLocationSwitched(_locationId, locationName) {
    setPriceOverrides({});
    setPinStaged(false);
    setStaleNote(null);
    setPriceResetNote(`Prices reset for ${locationName} — review again`);
  }

  // Rule 113 + the location tick, reset together — five pieces of state that all describe trust
  // earned about ONE specific review (this order, this location, these typed prices) and must never
  // survive past it. Three call sites need exactly this reset: dismissing the confirm dialog without
  // billing (handleCancelBillConfirm, unchanged from before), a billing attempt that failed for a
  // reason unrelated to price (INSUFFICIENT_STOCK, VALIDATION_ERROR, ...) — which used to leave all
  // five sitting here, so clicking "Mark billed" on a DIFFERENT order sharing an article could
  // silently inherit the first order's typed price and PIN progress — and opening the modal fresh,
  // as a second line of defence regardless of how it got dirty. One function so those three sites
  // can't drift into resetting four of the five and forgetting the fifth.
  function resetPriceAndLocationReview() {
    setPriceOverrides({});
    setPinStaged(false);
    setPriceResetNote(null);
    setStaleNote(null);
    setLocationConfirmed(false);
  }

  // Independent of the fetched data — a pure calendar fact, computed once at mount, so it never
  // resets back to "this month" on a refetch (e.g. after billing an order) if the owner had
  // already navigated to a different month.
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthKey());

  function loadOrders() {
    setOrdersStatus('loading');
    setOrdersError(null);
    listOrders()
      .then((list) => setOrders(list))
      .catch((err) => setOrdersError(err.message))
      .finally(() => setOrdersStatus('loaded'));
  }

  useEffect(() => {
    loadOrders();
  }, []);

  // Fetch on first need only — a cached or in-flight entry means there's nothing to do. Shared
  // by toggleOrder (expanding a row) and the "Mark billed" trigger below (added 2026-08-25) —
  // the confirm modal's live discount/GST preview needs this same full line-item detail
  // (qtySetsPacked, priceAtOrder, product size shape), and "Mark billed" is reachable directly
  // from the collapsed header, so it can't assume a row's detail happens to be loaded already.
  function ensureDetail(orderId) {
    setDetails((prev) => {
      if (prev[orderId]) return prev;
      getOrder(orderId)
        .then((order) => setDetails((d) => ({ ...d, [orderId]: { status: 'loaded', order } })))
        .catch((err) => setDetails((d) => ({ ...d, [orderId]: { status: 'error', error: err.message } })));
      return { ...prev, [orderId]: { status: 'loading' } };
    });
  }

  function toggleOrder(orderId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
        return next;
      }
      next.add(orderId);
      return next;
    });
    ensureDetail(orderId);
  }

  function toggleArticle(orderId, productId) {
    const key = `${orderId}:${productId}`;
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // `pin` is present only when PinPrompt called this (the rule 113 path); the plain confirm button
  // calls it with nothing. That argument also decides the error contract — PinPrompt needs a THROWN
  // error to stop its spinner and render the failure, the plain button path has nowhere to throw to.
  // Identical to BillOrderDetail.jsx's handler, deliberately.
  async function handleConfirmBill(pin) {
    const fromPinPrompt = pin != null;
    const target = billTarget;
    setBillError(null);
    setStaleNote(null);
    // `billingInputIncomplete` is declared further down this same component function, but that's
    // fine here: this closure isn't invoked until a later click, well after that `const` has been
    // assigned for the current render — identical reasoning to BillOrderDetail.jsx's own copy of
    // this check.
    //
    // This exists specifically for the PIN step: once `pinStaged` is true, ConfirmModal's own button
    // is HIDDEN (hideConfirm), so `confirmDisabled={billingInputIncomplete}` no longer guards
    // anything — the only thing left calling this function is PinPrompt's own submit, which knows
    // nothing about discount/GST validity, stock, or rule 113's own price/PIN inputs. Without this, a
    // stock check turning blocking (or a discount % becoming invalid) between staging the PIN and
    // submitting it would let PinPrompt push the request through anyway.
    if (billingInputIncomplete) {
      const message = 'Some billing details are incomplete or invalid — review them before confirming.';
      setBillError(message);
      if (fromPinPrompt) throw new Error(message);
      return;
    }
    // Defensive, not decorative — the confirm button is disabled while `preview` is unready (see
    // billingInputIncomplete below). Same guard BillOrderDetail.jsx's identical handler uses,
    // and for the same reason: a UI-only guard is never trusted as the real one on the one
    // irreversible action in the whole order lifecycle.
    if (!preview) {
      const message = 'Prices are still loading for this location — wait a moment and try again.';
      setBillError(message);
      if (fromPinPrompt) throw new Error(message);
      return;
    }
    setBilling(true);
    try {
      // Only the raw applicable/percent inputs and the seenPrices echo go over the wire — same
      // reasoning as BillOrderDetail.jsx's identical call: the server independently recomputes
      // and stores preTaxAmount/finalAmount/actualPayable, never trusting a client-computed
      // figure. The body is exactly the keys PATCH /api/orders/:id/bill allows (04_API_SPEC.md).
      const updated = await billOrder(target.id, {
        discountApplicable,
        discountPercent: discountApplicable ? Number(discountPercent) : null,
        gstApplicable,
        gstPercent: gstApplicable ? Number(gstPercent) : null,
        // Owner's real toggle + checkbox state, never a hardcoded true — the server rejects
        // locationConfirmed !== true independently of anything this screen does.
        locationId: fulfillLocationId,
        locationConfirmed,
        // Omitted entirely when blank rather than sent as '' — identical to BillOrderDetail.jsx.
        ...(cleanBillNo(billNo) ? { billNo: cleanBillNo(billNo) } : {}),
        // Rule 113 — required on every bill. Built from exactly the `preview` object rendered on
        // screen, so this describes what the owner actually saw, never a recomputation.
        seenPrices: seenPricesFromPreview(preview),
        // Rule 113 — ONLY the articles whose typed price actually differs from the baseline, with the
        // key omitted entirely when nothing changed. An override equal to the baseline is a no-op
        // server-side, so sending one would claim a change the owner did not make.
        ...(pricing.priceOverrides.length > 0 ? { priceOverrides: pricing.priceOverrides } : {}),
        // Only when PinPrompt supplied one — the server decides for itself whether a PIN was
        // required, so an omitted PIN on a changed price is a 403, not an unauthorised bill.
        ...(fromPinPrompt ? { pin } : {}),
      });
      setBillTarget(null);
      setBillNo('');
      // Reflect the new status immediately in both the collapsed row (from the list refetch,
      // which also picks up any totalValue drift) and the cached detail, so an already-expanded
      // row doesn't show a stale PACKED state next to a Billed badge.
      loadOrders();
      setDetails((prev) => ({ ...prev, [target.id]: { status: 'loaded', order: updated } }));
    } catch (err) {
      // PRICES_CHANGED (rule 113) gets its own message naming what moved, and forces a fresh
      // preview — the owner must look again and confirm a second time; this never retries the bill
      // itself. The modal STAYS OPEN and every typed price is KEPT: their pricing decision is still
      // what they want, it is the baseline underneath it that moved. Dropping out of the PIN step is
      // the "confirm again" half — the PIN authorises a specific delta, and that delta has changed.
      if (err.code === 'PRICES_CHANGED' && Array.isArray(err.extra?.changedLines)) {
        setStaleNote(
          `Prices changed while you were reviewing: ${describeChangedLines(err.extra.changedLines, formatMoney).join('; ')}. Review and mark billed again.`
        );
        setPinStaged(false);
        refetchPreview();
      } else if (!PIN_ERROR_CODES.has(err.code)) {
        // Every non-PIN failure keeps its pre-existing behaviour: the real backend message in the
        // page-level banner, modal closed. The rule 113 / location-tick state must NOT survive this
        // close — this page lists every order in one place, so a stale typed price left sitting here
        // would otherwise reappear the moment "Mark billed" is clicked on a DIFFERENT order that
        // happens to share an article.
        setBillError(err.message);
        resetPriceAndLocationReview();
        setBillTarget(null);
      }
      // MISSING_PIN / INVALID_PIN / PIN_LOCKED fall through untouched — PinPrompt renders those
      // itself, including INVALID_PIN's "(N attempts remaining)", and the modal must stay open and
      // staged so the owner can retry the PIN.
      if (fromPinPrompt) throw err;
    } finally {
      setBilling(false);
    }
  }

  // Discount/GST inputs reset when the confirm dialog is dismissed WITHOUT billing — same
  // reasoning as BillOrderDetail.jsx's identical reset: re-opening always starts clean rather
  // than silently carrying over a half-filled previous attempt, possibly for a different order.
  function handleCancelBillConfirm() {
    setBillTarget(null);
    setDiscountApplicable(false);
    setDiscountPercent('');
    setGstApplicable(false);
    setGstPercent('');
    setBillNo('');
    // Confirmation tick, typed prices and PIN progress all reset here; the location CHOICE persists
    // (see BillOrderDetail's identical reasoning) — a stale tick or typed price must never carry into
    // the next order, which on THIS screen could easily be a different row entirely. One shared
    // function with the other two sites that need this identical reset — see its own comment.
    resetPriceAndLocationReview();
  }

  // One row's markup, shared by both sections — only the order and which date to show for it
  // differ (section 1 always shows createdAt; section 2 shows whichever stage/cancellation date
  // actually placed the order in the selected month).
  function renderOrderRow(order, dateIso) {
    const open = expanded.has(order.id);
    const detail = details[order.id];
    return (
      <div key={order.id} className={`dash-card accordion-section ${order.isCancelled ? 'dash-order-row-cancelled' : ''}`}>
        <div className="dash-order-row-header">
          <button type="button" className="accordion-header" onClick={() => toggleOrder(order.id)} aria-expanded={open}>
            <div className="accordion-header-text">
              <div className="accordion-title-sm">
                <span className="dash-order-party-name">{order.partyName}</span>
                {/* A cancelled order always reads as Cancelled here, regardless of the
                    status it was cancelled AT — the underlying status (kept, never
                    rewritten by cancellation — see cancelOrder) is no longer the useful
                    fact once nothing about this order can move forward. */}
                {order.isCancelled ? (
                  <span className="badge badge-danger dash-order-status-badge">Cancelled</span>
                ) : (
                  <span className={`badge ${ORDER_STATUS_BADGE[order.status]} dash-order-status-badge`}>
                    {ORDER_STATUS_LABEL[order.status]}
                  </span>
                )}
              </div>
              <div className="accordion-subtitle">
                {order.lineItemCount} line{order.lineItemCount === 1 ? '' : 's'} · {formatMoney(order.totalValue)} ·{' '}
                {formatDate(dateIso)}
              </div>
            </div>
            <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
          </button>

          {/* Only on PACKED, non-cancelled orders — the one owner-initiated status
              transition (rule 70). A cancelled order can sit at status PACKED forever
              (cancellation never rewrites status, see cancelOrder), so status alone isn't
              enough to decide this — billOrder() itself already 409s on a cancelled order
              (ORDER_CANCELLED), but the button shouldn't be offered in the first place. */}
          {order.status === 'PACKED' && !order.isCancelled && (
            <button
              type="button"
              className="btn-primary btn-inline"
              onClick={() => {
                setBillTarget(order);
                // Second line of defence, alongside the reset already in handleCancelBillConfirm and
                // in handleConfirmBill's non-PIN catch branch: whatever closed the modal last time
                // (for THIS order or a previous one — this page lists many), opening it again always
                // starts from a clean price/PIN/location-tick review rather than trusting every close
                // path to have already cleared it.
                resetPriceAndLocationReview();
                setBillNo('');
                // Keeps the row's own expanded-body detail in sync — this button is reachable
                // from the collapsed header, so the row isn't necessarily expanded (and its
                // detail fetched) already. NOT what the confirm modal's pricing depends on any
                // more (rule 113): the modal's total, per-line prices and confirm-readiness all
                // come from the fulfillment preview below instead of this order detail's
                // priceAtOrder — see billingInputIncomplete's own comment.
                ensureDetail(order.id);
                // Force a fresh fulfillment preview every time this modal opens, even for the
                // SAME order at the SAME location as a previous attempt — fulfillLocationId
                // persists across a cancelled confirm (handleCancelBillConfirm), so without this
                // a reopened modal could otherwise show a preview fetched minutes ago. Harmless
                // either way (billOrder's own stale-price check is the real guard), but this
                // keeps what's ON SCREEN honest. A no-op while fulfillLocationId is still null.
                refetchPreview();
              }}
              disabled={billing}
            >
              Mark billed
            </button>
          )}
        </div>

        {open && (
          <div className="accordion-body">
            {!detail || detail.status === 'loading' ? (
              <p className="muted dash-empty">Loading…</p>
            ) : detail.status === 'error' ? (
              <p className="error-banner" role="alert">
                Could not load this order's lines: {detail.error}
              </p>
            ) : (
              (() => {
                // renderLine's `showArticle` mirrors Live Stock's own "state it once in the
                // group header, drop it from every row inside" convention (§5.5's locationGroups)
                // — used below only in the multi-article branch, where an accordion header
                // already names the article. The single-article branch keeps showArticle: true,
                // so that case's rows are BYTE-IDENTICAL to what this screen rendered before this
                // change (same label, same meta line) — nothing regresses for today's real
                // single-article orders like SAI's.
                function renderLine(li, { showArticle }) {
                  return (
                    // Cancelled lines stay visible, struck through — same "never hide, never
                    // hard-delete" convention Bill/Pack Order detail already use, not filtered
                    // out here either.
                    <div key={li.id} className={`dash-order-line ${li.isCancelled ? 'dash-order-line-cancelled' : ''}`}>
                      <div className="dash-order-line-main">
                        <span className="dash-order-line-label">
                          {showArticle ? `${li.productArticleNo} — ${li.productName} · ${li.colorName}` : li.colorName}
                        </span>
                        {li.isCancelled && <span className="badge badge-danger">Cancelled</span>}
                      </div>
                      {!li.isCancelled && (
                        <span className="muted dash-order-line-meta">
                          Ordered: {pluralSets(li.qtySetsRequested)} · Packed:{' '}
                          {detail.order.status === 'PLACED' ? 'Not yet packed' : pluralSets(li.qtySetsPacked)} ·{' '}
                          {formatMoney(lineValue(li, detail.order.status))}
                        </span>
                      )}
                    </div>
                  );
                }

                const groups = buildArticleGroups(detail.order.lineItems, detail.order.status);

                // Established "no accordion wrapper for a single item" convention (Transfer's
                // single-colour articles, Live Stock's single-location articles) applied one
                // level up: a single distinct article has nothing to disambiguate, so it costs a
                // click for nothing — render its colour rows flat, exactly as this screen always
                // has. Only a genuinely multi-article order gets real per-article accordions.
                if (groups.length <= 1) {
                  return (groups[0]?.lines ?? []).map((li) => renderLine(li, { showArticle: true }));
                }

                return groups.map((group) => {
                  const articleKey = `${order.id}:${group.productId}`;
                  const articleOpen = expandedArticles.has(articleKey);
                  return (
                    <div key={group.productId} className="accordion-section nested">
                      <button
                        type="button"
                        className="accordion-header nested"
                        onClick={() => toggleArticle(order.id, group.productId)}
                        aria-expanded={articleOpen}
                      >
                        <div className="accordion-header-text">
                          <div className="accordion-title-sm">
                            {group.articleNo}
                            <span className="muted"> — {group.productName} · {formatMoney(group.total)}</span>
                          </div>
                        </div>
                        <ChevronIcon className={articleOpen ? 'chevron chevron-open' : 'chevron'} />
                      </button>

                      {articleOpen && (
                        <div className="accordion-body nested">
                          {group.lines.map((li) => renderLine(li, { showArticle: false }))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()
            )}

            {/* Billing breakdown — shown ONLY for an order carrying a real rule 101 snapshot.
                This exists because of rule 103: the collapsed header now shows actualPayable
                (the real amount owed, discount/GST inclusive), while the per-line figures above
                are pre-tax by nature. Without this the two would silently disagree — the lines
                wouldn't add up to the header — which is exactly the "two different bases on one
                screen" problem lineValue's own comment warns about. Rather than dropping back to
                the pre-tax header (wrong money) or rescaling each line (inventing per-line
                numbers that were never stored), the arithmetic connecting them is made visible.
                Orders with no snapshot render nothing here and are completely unchanged: their
                lines still sum exactly to their header. */}
            {detail.status === 'loaded' && detail.order.actualPayable != null && (
              <div className="dash-order-billing">
                <div className="bill-pricing-line">
                  <span>Pre-tax total</span>
                  <span>{formatPaise(Number(detail.order.preTaxAmount))}</span>
                </div>
                {detail.order.discountApplicable && (
                  <div className="bill-pricing-line">
                    <span>Discount ({Number(detail.order.discountPercent)}%)</span>
                    <span>
                      −{formatPaise(Number(detail.order.preTaxAmount) - Number(detail.order.finalAmount))}
                    </span>
                  </div>
                )}
                {detail.order.gstApplicable && (
                  <div className="bill-pricing-line">
                    <span>GST ({Number(detail.order.gstPercent)}%)</span>
                    {/* Derived from the UNROUNDED payable, not the stored one. Since rule 109
                        (2026-09-19) actualPayable is rounded to the whole rupee, so the old
                        `actualPayable − finalAmount` would quietly fold the rounding into the GST
                        figure and report a rate that doesn't match gstPercent. Subtracting the
                        adjustment back out first restores the real GST, and leaves the rounding to
                        be shown as its own line below rather than hidden inside this one.
                        `?? 0` covers orders billed before rule 109, whose adjustment is null and
                        whose actualPayable was never rounded — for those this is unchanged. */}
                    <span>
                      +{formatPaise(
                        Number(detail.order.actualPayable) -
                          Number(detail.order.roundingAdjustment ?? 0) -
                          Number(detail.order.finalAmount)
                      )}
                    </span>
                  </div>
                )}
                {/* Rule 109's rounding, shown only when it actually did something. Omitted entirely
                    at exactly 0 (and for pre-rule-109 orders, where it is null) so the overwhelming
                    majority of orders aren't given a meaningless "Rounding: ₹0" row. The sign is
                    explicit in both directions because a party being rounded down reads very
                    differently from being rounded up. */}
                {Number(detail.order.roundingAdjustment ?? 0) !== 0 && (
                  <div className="bill-pricing-line">
                    <span>Rounding</span>
                    {/* T1 (2026-09-30): kept on its own hand-built toFixed(2) rather than switched
                        onto formatMoney's new 'paise' mode (utils/money.js), which fixes the exact
                        3-decimal bug this comment used to cite against the old local
                        formatCurrency() — that reason is gone now. Left alone anyway: toFixed(2)
                        and toLocaleString's fraction-digit rounding aren't guaranteed to round a
                        boundary value (e.g. exactly half a paisa) the same way in every JS engine,
                        and this line is the one place on this screen a difference of ±₹0.01 would
                        be visible against the real rounding the server applied. Per T1's own
                        instruction to leave this line untouched when unsure whether the output
                        would stay byte-identical — it stays untouched. */}
                    <span>
                      {Number(detail.order.roundingAdjustment) > 0 ? '+' : '−'}₹
                      {Math.abs(Number(detail.order.roundingAdjustment)).toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="bill-pricing-final">
                  <span>Amount billed</span>
                  <span>{formatMoney(Number(detail.order.actualPayable))}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (ordersStatus !== 'loaded') {
    return (
      <>
        {ordersError && (
          <p className="error-banner" role="alert">
            Could not load orders: {ordersError}
          </p>
        )}
        {!ordersError && <p className="muted dash-empty">Loading…</p>}
      </>
    );
  }

  const openOrders = orders.filter(isOpenOrder);
  const monthOrders = orders.filter((o) => !isOpenOrder(o));

  // Every month with a real order in it, plus the current month always (even if it'll render
  // empty — that's the "clean view" the dropdown is meant to give, per the task), most recent
  // first. Lexicographic sort on "YYYY-MM" strings is a correct chronological sort here.
  const monthKeys = new Set([currentMonthKey()]);
  monthOrders.forEach((o) => monthKeys.add(monthKeyOf(bucketDateOf(o))));
  const sortedMonthKeys = [...monthKeys].sort((a, b) => b.localeCompare(a));

  const visibleMonthOrders = monthOrders.filter((o) => monthKeyOf(bucketDateOf(o)) === selectedMonth);

  // Whether there's a real, CURRENT preview to bill from — "current" meaning it matches
  // fulfillLocationId AND billTarget.id, which useFulfillmentPreview guarantees by resetting
  // `preview` to null the instant either changes (see that hook's own comment). previewError
  // counts as NOT ready: a failed fetch leaves nothing safe to build seenPrices from.
  const previewReady = previewStatus === 'loaded' && !!preview && !previewError;

  // Live discount/GST preview for the bill-confirm modal (rule 101/113) — now built on
  // preview.preTaxAmount, the SAME billedUnitPrice-based figure billOrder() itself computes and
  // charges (utils/locationPricing.js), rather than a client-side sum of priceAtOrder from the
  // lazily-fetched order detail. That distinction is the whole point of this task: priceAtOrder is
  // what the party was quoted, which can differ from what they're actually billed once an article
  // has a location-level selling override (rule 111). previewReady replaces the old
  // billDetailReady as the readiness gate — the order detail (`details[billTarget.id]`) still gets
  // fetched via ensureDetail for the row's own expanded body, but the confirm modal no longer
  // depends on it.
  //
  // Rule 113: once a price is typed, preview.preTaxAmount is the total for the OLD prices, so the
  // discount/GST preview must build on the estimate instead. Gated explicitly on pricing.pinRequired
  // — not just "use the estimate whenever it exists" — for the identical reason
  // BillOrderDetail.jsx's own copy of this expression is: with nothing typed, estimatedPreTax and
  // preview.preTaxAmount are mathematically equal, so showing the client-computed one anyway would
  // discard the more trustworthy of two equal numbers on every ordinary bill for no reason. The
  // `?? preview.preTaxAmount` fallback covers pinRequired being true while the estimate is still
  // null (the order detail hasn't landed yet) — billingInputIncomplete already blocks confirming
  // through that window regardless.
  const billPreTaxAmount = previewReady
    ? pricing.pinRequired
      ? (pricing.estimatedPreTax ?? preview.preTaxAmount)
      : preview.preTaxAmount
    : 0;
  const billAmounts = computeBillingAmounts({
    preTaxAmount: billPreTaxAmount,
    discountApplicable,
    discountPercent,
    gstApplicable,
    gstPercent,
  });
  // !previewReady is new (rule 113) and is the button-disabling half of "never bill with a
  // previous location's prices" — same reasoning as BillOrderDetail.jsx's identical guard.
  // pricing.hasErrors is the same guard applied to rule 113's inputs: a typed price the server would
  // reject (0, negative, three decimals) must not be pressable through to a 400.
  const billingInputIncomplete =
    (discountApplicable && !billAmounts.hasDiscount) ||
    (gstApplicable && !billAmounts.hasGst) ||
    !fulfillLocationId ||
    !locationConfirmed ||
    !previewReady ||
    pricing.hasErrors;

  return (
    <>
      {ordersError && (
        <p className="error-banner" role="alert">
          Could not refresh orders: {ordersError}
        </p>
      )}
      {billError && (
        <p className="error-banner" role="alert">
          Could not mark that order billed: {billError}
        </p>
      )}

      <section>
        <div className="dash-section-head">
          <h2 className="dash-section-title">Open orders</h2>
        </div>
        {openOrders.length === 0 ? (
          <p className="muted dash-empty">No open orders right now.</p>
        ) : (
          openOrders.map((order) => renderOrderRow(order, order.createdAt))
        )}
      </section>

      <section className="dash-section-spaced">
        <div className="dash-section-head">
          <h2 className="dash-section-title">Order history</h2>
          <div className="dash-month-picker">
            <label htmlFor="dash-orders-month" className="dash-month-picker-label">
              Month
            </label>
            <select id="dash-orders-month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
              {sortedMonthKeys.map((key) => (
                <option key={key} value={key}>
                  {monthLabelOf(key)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {visibleMonthOrders.length === 0 ? (
          <p className="muted dash-empty">No orders in {monthLabelOf(selectedMonth)}.</p>
        ) : (
          visibleMonthOrders.map((order) => renderOrderRow(order, bucketDateOf(order)))
        )}
      </section>

      {/* Deliberately the SAME weight of copy BillOrderDetail's own confirm uses for this exact
          action — it's the one irreversible step in the order lifecycle regardless of which
          screen triggers it.

          Discount/GST questions (rule 101) live inside this same confirm flow, same as mobile —
          computed from the lazily-fetched detail (ensureDetail, triggered by "Mark billed" above)
          via the SAME shared utils/orderBilling.js functions BillOrderDetail.jsx uses, so the two
          real billing entry points can never disagree on the same order's numbers.

          T6b (2026-10-05, docs/REVAMP_PLAN.md) — the same move T6a made on mobile. size="wide" makes
          this a ~1040px centred dialog (a full-screen sheet below 900px) with the action pinned to
          the bottom; the body is BillReviewPanel, the display-only layout both billing screens now
          share. Every value and handler it shows still comes from this file. A wide dialog ignores
          clicks outside it (ConfirmModal's header comment), so typed prices can only be thrown away
          by an explicit Cancel. Bill No. is new on this screen (Owner decision Q7). */}
      <ConfirmModal
        open={!!billTarget}
        size="wide"
        title="Bill this order? This cannot be undone."
        body={
          billTarget
            ? `This immediately deducts real stock and permanently locks ${billTarget.partyName}'s order — no quantity, price or packing change is possible after this, ever. There is no way to reverse it.`
            : ''
        }
        // Rule 113 makes this a TWO-STEP confirm whenever a price changed: this button stages the
        // PIN step, and PinPrompt's own submit (which replaces this one — see `footer` below)
        // bills. Unchanged prices leave it the one-step confirm it always was. The arrow wrapper is
        // load-bearing on the non-PIN path: ConfirmModal calls onConfirm as a click handler, so
        // passing handleConfirmBill bare would hand it the click EVENT as its `pin`.
        confirmLabel={
          pricing.pinRequired ? 'Review changes & enter PIN' : billing ? 'Billing…' : 'Bill and lock order'
        }
        tone="danger"
        onConfirm={pricing.pinRequired ? () => setPinStaged(true) : () => handleConfirmBill()}
        onCancel={handleCancelBillConfirm}
        confirmDisabled={billing || billingInputIncomplete}
        // The PIN step — identical to BillOrderDetail.jsx's (T6a). `footer` REPLACES the default
        // Cancel/Confirm buttons in the pinned footer (which is why hideConfirm is gone — with a
        // footer passed, the default buttons aren't rendered at all), so the PIN field appears where
        // the Bill button was. `undefined` when not staged gives back the default buttons.
        //
        // PinPrompt — the shared component, not a hand-copied field — owns the input, the submit
        // button, the in-flight label and the INVALID_PIN "(N attempts remaining)" rendering, which
        // is why handleConfirmBill re-throws a PIN failure rather than swallowing it. It owns its own
        // <form>, and ConfirmModal renders none, so there's no form nested in a form.
        //
        // No .bill-pricing-pin wrapper: the pinned footer already has its own top border, so that
        // class's divider would be a double line. A passed footer has no default Cancel, so this one
        // carries its own — backing out must always be possible.
        footer={
          pinStaged ? (
            <>
              <p className="muted hint-text">Enter your PIN to bill at the new prices.</p>
              <PinPrompt
                submitLabel="Bill and lock order"
                submittingLabel="Billing…"
                autoFocus
                onSubmit={handleConfirmBill}
              />
              <div className="action-row">
                <button type="button" className="link-button" onClick={() => setPinStaged(false)}>
                  Change prices
                </button>
                <button type="button" className="link-button" onClick={handleCancelBillConfirm}>
                  Cancel
                </button>
              </div>
            </>
          ) : undefined
        }
      >
        {/* Every prop below is a value or handler this file already had (plus the new billNo); the
            panel lays them out and computes nothing (see its own header comment). Mapping from the
            inline JSX this replaced:
            - pickerProps / priceReviewProps: exactly the props BillFulfillmentPicker and
              BillPriceReview were given inline. Price inputs stay disabled on the PIN step
              (`pinStaged`); "Change prices" in the footer unstages to edit them.
            - hasLocation: the `!fulfillLocationId` check the Order-total line used to branch on.
            - preTaxAmount: billPreTaxAmount (0, not null, before the preview is ready — the panel
              only displays it once previewReady, so that difference never shows).
            - the percent handlers keep clampPercent exactly as before (100 for discount, 5 for GST).
            - amounts: billAmounts, already the whole computeBillingAmounts object.
            - billNo / onBillNoChange / billNoDisabled: new (Q7); `billing` is this screen's busy
              flag, the counterpart of mobile's `submitting`. */}
        <BillReviewPanel
          pickerProps={{
            locationId: fulfillLocationId,
            onLocationChange: setFulfillLocationId,
            confirmed: locationConfirmed,
            onConfirmedChange: setLocationConfirmed,
            onLocationSwitched: handleLocationSwitched,
            previewStatus,
            preview,
            previewError,
          }}
          priceReviewProps={{
            pricing,
            onOverrideChange: handleOverrideChange,
            formatCurrency: formatMoney,
            costStatus,
            costError,
            resetNote: priceResetNote,
            disabled: billing || pinStaged,
          }}
          hasLocation={!!fulfillLocationId}
          previewReady={previewReady}
          previewError={previewError}
          preTaxAmount={billPreTaxAmount}
          pinRequired={pricing.pinRequired}
          staleNote={staleNote}
          discountApplicable={discountApplicable}
          onDiscountApplicableChange={setDiscountApplicable}
          discountPercent={discountPercent}
          onDiscountPercentChange={(value) => setDiscountPercent(clampPercent(value, 100))}
          gstApplicable={gstApplicable}
          onGstApplicableChange={setGstApplicable}
          gstPercent={gstPercent}
          onGstPercentChange={(value) => setGstPercent(clampPercent(value, 5))}
          amounts={billAmounts}
          billNo={billNo}
          onBillNoChange={setBillNo}
          billNoDisabled={billing}
        />
      </ConfirmModal>
    </>
  );
}
