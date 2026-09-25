import { useEffect, useState } from 'react';
import { ChevronIcon } from '../../components/icons';
import ConfirmModal from '../../components/ConfirmModal';
import { listOrders, getOrder, billOrder } from '../../api/orders';
import { piecesPerSetFor } from '../../utils/piecesPerSet';
import { computeBillingAmounts, clampPercent, seenPricesFromPreview, describeChangedLines } from '../../utils/orderBilling';
import BillFulfillmentPicker from '../../components/BillFulfillmentPicker';
import { useFulfillmentPreview } from '../../hooks/useFulfillmentPreview';
import { ORDER_STATUS_LABEL, ORDER_STATUS_BADGE, isOpenOrder } from '../../utils/orderStatus';

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

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

// A line's value is qtySetsRequested-based (not qtySetsPacked), matching the basis GET
// /api/orders' own totalValue already uses for the row-level figure this page shows collapsed —
// so a line's value and the order's total agree, rather than mixing two different bases on one
// screen. (BillOrderDetail.jsx uses qtySetsPacked instead, but that's the pre-billing screen
// specifically showing what will actually be committed — a different question than this one.)
function lineValue(li) {
  if (li.isCancelled) return 0;
  return li.qtySetsRequested * piecesPerSetFor({ isKids: li.productIsKids, sizes: li.productSizes }) * Number(li.priceAtOrder);
}

// Groups an order's lines by Article, Colour lines nested inside — same shape BillOrderDetail.jsx
// already builds for the identical order data (grouped-by-productId, sorted by article number),
// just keyed on qtySetsRequested/lineValue instead of that screen's pre-billing qtySetsPacked
// basis (see lineValue's own comment above for why this screen uses the requested-quantity
// basis). Pure grouping — every number here is lineValue() summed, so the order's real
// preTaxAmount/actualPayable footer (computed server-side, read from detail.order directly) is
// completely unaffected by how these lines are arranged on screen.
function buildArticleGroups(lineItems) {
  return lineItems
    .reduce((acc, li) => {
      let group = acc.find((g) => g.productId === li.productId);
      if (!group) {
        group = { productId: li.productId, articleNo: li.productArticleNo, productName: li.productName, lines: [], total: 0 };
        acc.push(group);
      }
      group.lines.push(li);
      group.total += lineValue(li);
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
  // applied on top of now comes from useFulfillmentPreview on both screens (rule 113), not from
  // preBillingTotal — see that function's own comment for why.
  const [discountApplicable, setDiscountApplicable] = useState(false);
  const [discountPercent, setDiscountPercent] = useState('');
  const [gstApplicable, setGstApplicable] = useState(false);
  const [gstPercent, setGstPercent] = useState('');
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

  async function handleConfirmBill() {
    const target = billTarget;
    setBillError(null);
    // Defensive, not decorative — the confirm button is disabled while `preview` is unready (see
    // billingInputIncomplete below). Same guard BillOrderDetail.jsx's identical handler uses,
    // and for the same reason: a UI-only guard is never trusted as the real one on the one
    // irreversible action in the whole order lifecycle.
    if (!preview) {
      setBillError('Prices are still loading for this location — wait a moment and try again.');
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
        // Rule 113 — required on every bill. Built from exactly the `preview` object rendered on
        // screen, so this describes what the owner actually saw, never a recomputation.
        seenPrices: seenPricesFromPreview(preview),
      });
      setBillTarget(null);
      // Reflect the new status immediately in both the collapsed row (from the list refetch,
      // which also picks up any totalValue drift) and the cached detail, so an already-expanded
      // row doesn't show a stale PACKED state next to a Billed badge.
      loadOrders();
      setDetails((prev) => ({ ...prev, [target.id]: { status: 'loaded', order: updated } }));
    } catch (err) {
      // PRICES_CHANGED (rule 113) gets its own message naming what moved, and forces a fresh
      // preview for the next attempt — the owner must look again and press "Mark billed" a second
      // time; this never retries the bill itself. The two pre-existing realistic failures
      // (INSUFFICIENT_STOCK, ORDER_NOT_PACKED) keep their real backend message verbatim.
      if (err.code === 'PRICES_CHANGED' && Array.isArray(err.extra?.changedLines)) {
        setBillError(
          `Prices changed while you were reviewing: ${describeChangedLines(err.extra.changedLines, formatCurrency).join('; ')}. Review the new prices and mark billed again.`
        );
        refetchPreview();
      } else {
        setBillError(err.message);
      }
      setBillTarget(null);
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
    // Confirmation resets every time; the location choice persists (see BillOrderDetail's
    // identical reasoning) — a stale tick must never carry into the next order.
    setLocationConfirmed(false);
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
                {order.lineItemCount} line{order.lineItemCount === 1 ? '' : 's'} · {formatCurrency(order.totalValue)} ·{' '}
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
                          {formatCurrency(lineValue(li))}
                        </span>
                      )}
                    </div>
                  );
                }

                const groups = buildArticleGroups(detail.order.lineItems);

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
                            <span className="muted"> — {group.productName} · {formatCurrency(group.total)}</span>
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
                  <span>{formatCurrency(Number(detail.order.preTaxAmount))}</span>
                </div>
                {detail.order.discountApplicable && (
                  <div className="bill-pricing-line">
                    <span>Discount ({Number(detail.order.discountPercent)}%)</span>
                    <span>
                      −{formatCurrency(Number(detail.order.preTaxAmount) - Number(detail.order.finalAmount))}
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
                      +{formatCurrency(
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
                    {/* toFixed(2) rather than the shared formatCurrency, which is the only place on
                        this screen that deviates from it. formatCurrency's toLocaleString('en-IN')
                        defaults to 3 fraction digits, so a real adjustment of 0.1653 would render
                        "₹0.165" — three decimals on a figure whose whole meaning is paise. This is
                        always a sub-rupee value, so it gets the 2-decimal money precision a person
                        actually reads it in; no thousands separator is needed for a value that
                        cannot exceed ₹0.50. */}
                    <span>
                      {Number(detail.order.roundingAdjustment) > 0 ? '+' : '−'}₹
                      {Math.abs(Number(detail.order.roundingAdjustment)).toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="bill-pricing-final">
                  <span>Amount billed</span>
                  <span>{formatCurrency(Number(detail.order.actualPayable))}</span>
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
  const billPreTaxAmount = previewReady ? preview.preTaxAmount : 0;
  const billAmounts = computeBillingAmounts({
    preTaxAmount: billPreTaxAmount,
    discountApplicable,
    discountPercent,
    gstApplicable,
    gstPercent,
  });
  // !previewReady is new (rule 113) and is the button-disabling half of "never bill with a
  // previous location's prices" — same reasoning as BillOrderDetail.jsx's identical guard.
  const billingInputIncomplete =
    (discountApplicable && !billAmounts.hasDiscount) ||
    (gstApplicable && !billAmounts.hasGst) ||
    !fulfillLocationId ||
    !locationConfirmed ||
    !previewReady;

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
          real billing entry points can never disagree on the same order's numbers. */}
      <ConfirmModal
        open={!!billTarget}
        title="Bill this order? This cannot be undone."
        body={
          billTarget
            ? `This immediately deducts real stock and permanently locks ${billTarget.partyName}'s order — no quantity, price or packing change is possible after this, ever. There is no way to reverse it.`
            : ''
        }
        confirmLabel={billing ? 'Billing…' : 'Bill and lock order'}
        tone="danger"
        onConfirm={handleConfirmBill}
        onCancel={handleCancelBillConfirm}
        confirmDisabled={billing || billingInputIncomplete}
      >
        <div className="bill-pricing-questions">
          {/* Rule 113 — sourced from the fulfillment preview, not priceAtOrder. Same three-plus-one
              state structure as BillOrderDetail.jsx's identical block: no location chosen yet,
              loading, a failed fetch (billing is blocked either way — see billingInputIncomplete —
              so this says why), or ready. billTarget is always truthy here: these children only
              render while the modal is open, and the modal's own `open` is `!!billTarget`. */}
          {!fulfillLocationId ? (
            <p className="muted bill-pricing-pretax">Choose a fulfilment location to see the order total.</p>
          ) : previewError ? (
            <p className="error-banner" role="alert">
              Could not load prices for this location: {previewError}
            </p>
          ) : !previewReady ? (
            <p className="muted bill-pricing-pretax">Loading prices for this location…</p>
          ) : (
            <p className="muted bill-pricing-pretax">Order total: {formatCurrency(billPreTaxAmount)}</p>
          )}

          {/* Fulfilment location above the money questions, same order as mobile. Rendered
              unconditionally (not gated on previewReady) because it's what SELECTS the location
              that makes a preview exist in the first place — same reasoning as
              BillOrderDetail.jsx's identical placement. */}
          <BillFulfillmentPicker
            locationId={fulfillLocationId}
            onLocationChange={setFulfillLocationId}
            confirmed={locationConfirmed}
            onConfirmedChange={setLocationConfirmed}
            previewStatus={previewStatus}
            preview={preview}
            previewError={previewError}
          />

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={discountApplicable}
              onChange={(e) => setDiscountApplicable(e.target.checked)}
            />
            Apply a discount?
          </label>
          {discountApplicable && (
            <div className="field bill-pricing-percent-field">
              <span className="field-label">Discount %</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(clampPercent(e.target.value, 100))}
                placeholder="e.g. 5"
                autoFocus
              />
            </div>
          )}
          {billAmounts.hasDiscount && (
            <p className="bill-pricing-line">
              −{formatCurrency(billAmounts.discountAmount)} discount → {formatCurrency(billAmounts.finalAmount)}
            </p>
          )}

          <label className="checkbox-field">
            <input type="checkbox" checked={gstApplicable} onChange={(e) => setGstApplicable(e.target.checked)} />
            Apply GST?
          </label>
          {gstApplicable && (
            <div className="field bill-pricing-percent-field">
              <span className="field-label">GST %</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.01"
                value={gstPercent}
                onChange={(e) => setGstPercent(clampPercent(e.target.value, 5))}
                placeholder="e.g. 5"
                autoFocus
              />
            </div>
          )}
          {billAmounts.hasGst && <p className="bill-pricing-line">+{formatCurrency(billAmounts.gstAmount)} GST</p>}

          <p className="bill-pricing-final">Total to bill: {formatCurrency(billAmounts.actualPayable)}</p>
        </div>
      </ConfirmModal>
    </>
  );
}
