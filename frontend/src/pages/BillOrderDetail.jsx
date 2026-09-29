import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InvoiceIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { useAuth } from '../hooks/useAuth';
import { getOrder, billOrder, cancelOrderLine, cancelOrder } from '../api/orders';
import { listStock } from '../api/stock';
import { piecesPerSetFor } from '../utils/piecesPerSet';
import { computeBillingAmounts, clampPercent, seenPricesFromPreview, describeChangedLines } from '../utils/orderBilling';
import BillFulfillmentPicker from '../components/BillFulfillmentPicker';
import BillPriceReview from '../components/BillPriceReview';
import PinPrompt from '../components/PinPrompt';
import { useFulfillmentPreview } from '../hooks/useFulfillmentPreview';
import { useOwnerCostPrices } from '../hooks/useOwnerCostPrices';
import { deriveBillPricing, PIN_ERROR_CODES } from '../utils/billPriceOverrides';
import { BILL_NO_MAX_LENGTH, cleanBillNo } from '../utils/billNo';

// Bill Orders — detail. Mirrors PackOrderDetail.jsx's structure (accordion grouped by article,
// sticky action bar, confirm before the mutation) but is entirely READ-ONLY above the button:
// billing commits exactly what packing already counted, so there is nothing to edit here. Any
// discrepancy between ordered and packed was settled at pack time and is shown, not adjustable.
//
// This is the ONE irreversible action in the whole order lifecycle — it deducts real stock FIFO
// across locations and applies rule 23's hard lock (no further edits to this order, ever). The
// confirm copy below is deliberately weightier than every other ConfirmModal in this app for
// that reason; it names both consequences explicitly rather than asking a generic "are you sure?"
//
// --- On the up-front stock check ---
// Real current stock is fetched on load and compared against each line's qtySetsPacked, so a line
// that CAN'T be billed is flagged the moment the screen opens rather than only after tapping the
// button. This is purely INFORMATIONAL: the backend's own INSUFFICIENT_STOCK check at bill time is
// still the real enforcement and is unchanged. Stock can genuinely move between this page loading
// and a real bill attempt (another order bills first, a transfer runs), so that error path is
// still handled here — this check just makes it the rare surprise instead of the primary way
// anyone discovers a shortage.
//
// A blocked line uses a DANGER tint, deliberately distinct from Pack Order's amber shortfall
// tint. Those are different severities and shouldn't look alike: amber there means "we proceeded
// with less than ordered," red here means "this cannot proceed at all.""

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

// utils/piecesPerSet.js's piecesPerSetFor expects a product-shaped { isKids, sizes } object;
// getOrder() returns those flattened onto the line item itself (productIsKids/productSizes), so
// this adapts the shape at the one call site below rather than changing the shared function.
function piecesPerSetForLine(li) {
  return piecesPerSetFor({ isKids: li.productIsKids, sizes: li.productSizes });
}

export default function BillOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  // This screen is already OWNER-only at the route, so this is belt-and-braces rather than the
  // real gate (which is requireRole('OWNER') on the API).
  const { user } = useAuth();
  const canCancel = user.role === 'OWNER';

  const [order, setOrder] = useState(null);
  const [orderStatus, setOrderStatus] = useState('idle');
  const [orderError, setOrderError] = useState(null);

  // Real stock, summed by bundleId — same unfiltered listStock() + client-side grouping pattern
  // PackOrderDetail.jsx already uses (see its own comment on why the full list is fetched rather
  // than one article's worth), reused here rather than rebuilt.
  const [stockByBundleId, setStockByBundleId] = useState({});

  const [expandedArticles, setExpandedArticles] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Discount/GST questions (added 2026-08-25, rule 101) — live-computed inside the same "Bill
  // this order?" confirm flow, not a separate step. Percent fields are strings (not numbers)
  // because a controlled number input needs to represent "nothing typed yet" as `''`, distinct
  // from `0` — the same idle/loaded discipline this project applies to async status elsewhere,
  // applied here to "not yet a real percent."
  const [discountApplicable, setDiscountApplicable] = useState(false);
  const [discountPercent, setDiscountPercent] = useState('');
  const [gstApplicable, setGstApplicable] = useState(false);
  const [gstPercent, setGstPercent] = useState('');
  // Optional reference tag captured at billing time (2026-08-30). Lives alongside the discount/GST
  // inputs because it's answered in the same moment, but it is NOT one of them: it feeds none of
  // the amount arithmetic below, and leaving it blank never blocks billing (see
  // billingInputIncomplete, which deliberately doesn't consider it).
  const [billNo, setBillNo] = useState('');
  // Fulfilment location (2026-09-07). Both are REQUIRED by the server — billing 400s without a
  // locationId and without locationConfirmed === true. Starts null rather than defaulting to a
  // location id here: BillFulfillmentPicker resolves the real GGN id from the API and calls back,
  // so this file never hardcodes a location id that a reseed could invalidate.
  const [fulfillLocationId, setFulfillLocationId] = useState(null);
  const [locationConfirmed, setLocationConfirmed] = useState(false);

  // The SAME preview BillFulfillmentPicker shows, fetched once here rather than a second time
  // inside it (see that component's header comment and useFulfillmentPreview's own). This is what
  // rule 113 needs the total, the per-line prices, and the seenPrices echo to come from — never a
  // client-side recomputation from priceAtOrder, which is a different, possibly outdated figure
  // once an article has a location-level or at-billing price.
  const { status: previewStatus, preview, error: previewError, refetch: refetchPreview } = useFulfillmentPreview(
    id,
    fulfillLocationId
  );

  // At-billing price overrides (rule 113). Raw typed strings keyed by productId — never numbers, so
  // a half-typed "48" or a trailing "480." round-trips unchanged instead of being reformatted out
  // from under the cursor (the same reasoning clampPercent's own comment records for the percent
  // fields). An absent key means "not changed", which is the normal case for every article.
  const [priceOverrides, setPriceOverrides] = useState({});
  // Whether the owner has pressed through the price review and is now on the PIN step. Separate
  // from "a PIN is required": required is derived from what was typed, staged is the owner's own
  // progression through the two steps.
  const [pinStaged, setPinStaged] = useState(false);
  // Shown inside the modal when a location switch discarded typed prices, and when a 409
  // PRICES_CHANGED sent the owner back to review. Both are "look again" messages that belong next to
  // the prices themselves, not in the page-level banner behind a modal the owner is still inside.
  const [priceResetNote, setPriceResetNote] = useState(null);
  const [staleNote, setStaleNote] = useState(null);

  // Cost prices for rule 113's below-cost warning. This screen is OWNER-only at the route
  // (App.jsx's requireRole="OWNER" on /bill-orders/:id), so this is always an owner fetch — the flag
  // is belt-and-braces over GET /api/products' own role gate, which is what actually keeps cost away
  // from STAFF. A failure here never blocks billing; it just means no warning.
  const { status: costStatus, costPriceByProductId } = useOwnerCostPrices(user.role === 'OWNER');

  // THE one derivation — utils/billPriceOverrides.js, shared with dashboard/Orders.jsx so the two
  // billing screens cannot show the same order two different prices, two different "is a PIN
  // needed" answers, or two different estimated totals. `order?.lineItems` is passed for the
  // estimated total only (the preview carries no piecesPerSet shape); null until the order loads,
  // which deriveBillPricing handles by returning a null estimate rather than a partial sum.
  const pricing = deriveBillPricing({
    preview,
    lineItems: order?.lineItems ?? null,
    overrides: priceOverrides,
    costPriceByProductId,
  });

  // Typing a price invalidates the PIN step: the summary and the PIN are about a specific set of
  // numbers, so changing them has to send the owner back to review rather than leaving a PIN field
  // sitting under a figure it no longer matches.
  function handleOverrideChange(productId, value) {
    setPriceOverrides((prev) => ({ ...prev, [productId]: value }));
    setPinStaged(false);
    setPriceResetNote(null);
    setStaleNote(null);
  }

  // A real location SWITCH only — BillFulfillmentPicker fires this from the same single branch that
  // clears the confirmation tick, never from its default-location pick and never from a preview
  // re-fetch. Everything typed against the previous location's baselines goes: a ₹480 the owner
  // approved as a ₹20 cut at Gurgaon could be a ₹70 cut at Delhi, which is the exact reasoning
  // rule 113 gives for refusing a moved baseline server-side.
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
  // five sitting here, so a SECOND bill attempt (or, on the desktop dashboard, a different order
  // sharing an article) could silently inherit the first attempt's typed price and PIN progress —
  // and opening the modal fresh, as a second line of defence against the same staleness regardless
  // of how it happened. One function so those three sites can't drift into resetting four of the
  // five and forgetting the fifth.
  function resetPriceAndLocationReview() {
    setPriceOverrides({});
    setPinStaged(false);
    setPriceResetNote(null);
    setStaleNote(null);
    setLocationConfirmed(false);
  }

  // Same single-target pattern as PackOrderDetail — { kind: 'line', line } or { kind: 'order' }.
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setOrderStatus('loading');
    setOrderError(null);
    Promise.all([getOrder(id), listStock()])
      .then(([data, stockRows]) => {
        if (cancelled) return;
        setOrder(data);
        const totals = {};
        stockRows.forEach((r) => {
          totals[r.bundleId] = (totals[r.bundleId] ?? 0) + r.qtySets;
        });
        setStockByBundleId(totals);
      })
      .catch((err) => {
        if (!cancelled) setOrderError(err.message);
      })
      .finally(() => {
        if (!cancelled) setOrderStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function toggleArticle(productId) {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  async function handleConfirmCancel() {
    setCancelError(null);
    setCancelling(true);
    try {
      if (cancelTarget.kind === 'order') {
        await cancelOrder(id);
        setCancelTarget(null);
        navigate('/bill-orders', { replace: true, state: { cancelledOutcome: { partyName: order.partyName } } });
        return;
      }
      const updated = await cancelOrderLine(id, cancelTarget.line.id);
      setOrder(updated);
      setCancelTarget(null);
    } catch (err) {
      setCancelTarget(null);
      setCancelError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  // `pin` is present only when PinPrompt called this (the rule 113 path); the plain confirm button
  // calls it with nothing. That one argument also decides the error contract: PinPrompt needs a
  // THROWN error to stop its spinner and render the failure, whereas the plain button path has
  // nowhere to throw to, so it sets a banner and returns. Hence `fromPinPrompt` rather than
  // branching on the error alone.
  async function handleConfirmBill(pin) {
    const fromPinPrompt = pin != null;
    setSubmitError(null);
    setStaleNote(null);
    // `billingInputIncomplete` is declared further down this same component function (after the
    // order-loading early returns), but that's fine here: this closure isn't invoked until a later
    // click, well after that `const` has been assigned for the current render — the ordinary JS rule
    // that a function can reference an enclosing `const` declared below it, as long as it only runs
    // after that declaration has executed, which every event handler here does.
    //
    // This check exists specifically for the PIN step: once `pinStaged` is true, ConfirmModal's own
    // button is HIDDEN (hideConfirm), so `confirmDisabled={billingInputIncomplete}` on that button no
    // longer guards anything — the only thing left calling this function is PinPrompt's own submit,
    // which knows nothing about discount/GST validity, stock, or rule 113's own price/PIN inputs.
    // Without this, staging the PIN step and then invalidating one of those (e.g. the order becomes
    // blocked by a stock check between staging and submitting) would let PinPrompt push the request
    // through anyway.
    if (billingInputIncomplete) {
      const message = 'Some billing details are incomplete or invalid — review them before confirming.';
      setSubmitError(message);
      if (fromPinPrompt) throw new Error(message);
      return;
    }
    // Defensive, not decorative — the confirm button is disabled while `preview` is unready (see
    // billingInputIncomplete below), so this should be unreachable in normal use. But a UI-only
    // guard is never trusted as the real one anywhere else in this app (locationConfirmed is the
    // same pattern), and billing is the one irreversible action in the whole lifecycle.
    if (!preview) {
      const message = 'Prices are still loading for this location — wait a moment and try again.';
      setSubmitError(message);
      if (fromPinPrompt) throw new Error(message);
      return;
    }
    setSubmitting(true);
    try {
      // Only the raw applicable/percent inputs and the seenPrices echo go over the wire — the
      // server independently recomputes preTaxAmount/finalAmount/actualPayable from live order
      // data and stores those; nothing computed for display is ever sent as a value to be trusted.
      // The body is exactly the keys PATCH /api/orders/:id/bill allows (04_API_SPEC.md) — the
      // server 400s on anything else, so there is nothing here beyond this list.
      await billOrder(id, {
        discountApplicable,
        discountPercent: discountApplicable ? Number(discountPercent) : null,
        gstApplicable,
        gstPercent: gstApplicable ? Number(gstPercent) : null,
        // The owner's real toggle choice and real checkbox state — never a hardcoded true. The
        // server independently rejects locationConfirmed !== true, so sending a literal here
        // would defeat the point of the checkbox rather than satisfy the requirement.
        locationId: fulfillLocationId,
        locationConfirmed,
        // Omitted entirely when blank rather than sent as '' — optional means optional, and the
        // order simply ends up with a null tag it can be given later.
        ...(cleanBillNo(billNo) ? { billNo: cleanBillNo(billNo) } : {}),
        // Rule 113 — required on every bill. Built from exactly the `preview` object rendered on
        // screen (never re-fetched or recomputed here), so this describes what the owner actually
        // saw, not what the client currently believes the price to be.
        seenPrices: seenPricesFromPreview(preview),
        // Rule 113 — ONLY articles whose typed price actually differs from the baseline, and the key
        // is omitted entirely when nothing changed. An override equal to the baseline is a
        // documented no-op server-side, so sending one would make the body claim a change the owner
        // did not make; and the body is a strict allowlist, so `undefined`/`[]` noise is worth
        // avoiding on principle even where it would be accepted.
        ...(pricing.priceOverrides.length > 0 ? { priceOverrides: pricing.priceOverrides } : {}),
        // Only when PinPrompt supplied one. The server decides for itself whether a PIN was
        // required, by comparing two arrays it computed — so an omitted PIN on a changed price is a
        // 403 MISSING_PIN, not a silently unauthorised bill.
        ...(fromPinPrompt ? { pin } : {}),
      });
      setConfirmOpen(false);
      navigate('/bill-orders', {
        replace: true,
        state: { billedOutcome: { partyName: order.partyName } },
      });
    } catch (err) {
      // PRICES_CHANGED (rule 113) gets its own message naming what moved, and forces a fresh
      // preview — the owner must look again and confirm a second time; this never retries the bill
      // itself. The modal STAYS OPEN and every typed price is KEPT: the owner's pricing decision is
      // still what they want, it is the baseline underneath it that moved, so throwing their work
      // away would be both rude and misleading. Dropping back out of the PIN step is the "require
      // confirm again" half — the PIN authorises a specific delta, and that delta has changed.
      if (err.code === 'PRICES_CHANGED' && Array.isArray(err.extra?.changedLines)) {
        setStaleNote(
          `Prices changed while you were reviewing: ${describeChangedLines(err.extra.changedLines, formatCurrency).join('; ')}. Review and bill again.`
        );
        setPinStaged(false);
        refetchPreview();
      } else if (!PIN_ERROR_CODES.has(err.code)) {
        // Every non-PIN failure keeps its pre-existing behaviour exactly: the real backend message
        // in the page-level banner, modal closed (INSUFFICIENT_STOCK, ORDER_NOT_PACKED, and now
        // VALIDATION_ERROR / ARTICLE_NOT_ON_ORDER, which read the same way).
        setSubmitError(err.message);
        // Discount/GST inputs are deliberately NOT cleared on this path — a real, valid entry the
        // owner already typed shouldn't vanish just because billing failed for an unrelated reason;
        // they can retry without re-entering it. The rule 113 / location-tick state is the opposite
        // case: it must NOT survive this close, or a later attempt on this order (or, on the
        // dashboard screen, a different order) would silently inherit a typed price and PIN
        // progress that were never re-confirmed for it.
        resetPriceAndLocationReview();
        setConfirmOpen(false);
      }
      // MISSING_PIN / INVALID_PIN / PIN_LOCKED deliberately fall through with no state change at
      // all: PinPrompt renders those itself, including INVALID_PIN's "(N attempts remaining)", and
      // the modal must stay open and staged so the owner can simply try the PIN again.
      if (fromPinPrompt) throw err;
    } finally {
      setSubmitting(false);
    }
  }

  // Discount/GST inputs reset when the confirm dialog is dismissed WITHOUT billing — re-opening
  // it (for this order or, after navigating away, a different one) always starts from a clean
  // "no discount, no GST" state rather than silently carrying over a half-filled previous attempt.
  function handleCancelBillConfirm() {
    setConfirmOpen(false);
    setDiscountApplicable(false);
    setDiscountPercent('');
    setGstApplicable(false);
    setGstPercent('');
    setBillNo('');
    // The confirmation tick, the typed prices and the PIN progress all reset here — the location
    // CHOICE itself does NOT (fulfillLocationId is untouched): re-opening must never carry over a
    // stale "yes I checked it" or a stale typed price, but re-showing the last picked location is a
    // harmless starting point (the picker re-previews it live on open anyway). One shared function
    // with the other two sites that need this identical reset — see its own comment.
    resetPriceAndLocationReview();
  }

  if (orderStatus !== 'loaded') {
    return (
      <div className="page">
        {/* tone="tile-red" (2026-08-27) — matches BillOrderList.jsx's own header change and
            Home's Bill Orders tile; see that file's comment for the full reasoning. */}
        <ScreenHeader icon={<InvoiceIcon size={20} />} tone="tile-red" title="Bill Orders" />
        {orderError ? (
          <p className="error-banner" role="alert">
            Could not load this order: {orderError}
          </p>
        ) : (
          <p className="muted centered-empty-state">Loading…</p>
        )}
      </div>
    );
  }

  // A stale list row or a direct link could point at an order someone else already billed —
  // caught here, before the button is even offered, rather than only at submit time.
  if (order.status !== 'PACKED') {
    return (
      <div className="page">
        {/* tone="tile-red" (2026-08-27) — matches BillOrderList.jsx's own header change and
            Home's Bill Orders tile; see that file's comment for the full reasoning. */}
        <ScreenHeader icon={<InvoiceIcon size={20} />} tone="tile-red" title="Bill Orders" />
        <p className="muted">{order.partyName}</p>
        <p className="error-banner" role="alert">
          This order can no longer be billed — its status is now {order.status}.
        </p>
      </div>
    );
  }

  // Grouped by article, same shape PackOrderDetail and New Order's summary both use. `total` is
  // this article's value across its non-cancelled lines only — qtySetsPacked, not
  // qtySetsRequested, because this is the PRE-BILLING screen and packed quantity is the
  // authoritative figure before billing (04_API_SPEC.md), exactly for a short-packed line like
  // this. A cancelled line contributes nothing, same reasoning as listOrders' totalValue fix.
  const groups = order.lineItems
    .reduce((acc, li) => {
      let group = acc.find((g) => g.productId === li.productId);
      if (!group) {
        group = { productId: li.productId, articleNo: li.productArticleNo, productName: li.productName, lines: [], total: 0 };
        acc.push(group);
      }
      group.lines.push(li);
      if (!li.isCancelled) {
        group.total += li.qtySetsPacked * piecesPerSetForLine(li) * Number(li.priceAtOrder);
      }
      return acc;
    }, [])
    .sort((a, b) => a.articleNo.localeCompare(b.articleNo));

  const liveLines = order.lineItems.filter((li) => !li.isCancelled);
  const cancelledCount = order.lineItems.length - liveLines.length;
  const totalPacked = liveLines.reduce((sum, li) => sum + li.qtySetsPacked, 0);
  const shortLines = liveLines.filter((li) => li.qtySetsPacked < li.qtySetsRequested).length;

  // A line is BLOCKED when real current stock can't cover what was packed — the same comparison
  // billOrder's own pre-check makes server-side. Computed here once and reused for the row tint,
  // the collapsed-header indicator, and the button's disabled state, so all three can never
  // disagree with each other.
  const availableFor = (li) => stockByBundleId[li.bundleId] ?? 0;
  // !li.isCancelled comes FIRST deliberately: a cancelled line is never billed, so it can never
  // block billing either. Cancelling a line whose stock ran short is precisely how an owner
  // unblocks the rest of the order, and this is the line of code that makes that true.
  const isBlocked = (li) => !li.isCancelled && li.qtySetsPacked > 0 && availableFor(li) < li.qtySetsPacked;
  const blockedLines = order.lineItems.filter(isBlocked);

  // Whether there's a real, CURRENT preview to bill from — "current" meaning it matches
  // fulfillLocationId, which useFulfillmentPreview guarantees by resetting `preview` to null the
  // instant the location changes (see that hook's own comment). previewError counts as NOT ready:
  // a failed fetch means there is nothing safe to build seenPrices from, so billing must stay
  // blocked exactly as if nothing had loaded at all.
  const previewReady = previewStatus === 'loaded' && !!preview && !previewError;

  // Live discount/GST preview (rule 101/113) — now built on preview.preTaxAmount, the SAME
  // billedUnitPrice-based figure billOrder() itself computes and charges (utils/locationPricing.js),
  // rather than a client-side sum of priceAtOrder. That distinction is the whole point of this
  // task: priceAtOrder is what the party was quoted, which can differ from what they're actually
  // billed once an article has a location-level selling override (rule 111). preTaxAmount is
  // `null` until previewReady — computeBillingAmounts tolerates that the same way it already
  // tolerates an empty percent field, returning 0s rather than NaN.
  //
  // Rule 113 layers one more thing on top: once the owner types a price, `preview.preTaxAmount` is
  // the total for the OLD prices, so the discount/GST preview must be built on the estimate instead.
  // Gated explicitly on `pricing.pinRequired` — NOT just "use the estimate whenever it exists" —
  // because `estimatedPreTax` is a client-side sum over a snapshot and is only actually needed once
  // a typed price makes it disagree with the server's own preview figure. With nothing typed, the
  // two are mathematically equal, but showing the estimate anyway would mean the more trustworthy of
  // two equal numbers is discarded for no reason on every ordinary bill. `?? preview.preTaxAmount` is
  // the fallback for the one case pinRequired can be true while the estimate is still null: the order
  // detail (needed for the piecesPerSet shape) hasn't arrived yet, which billingInputIncomplete
  // already keeps the owner from confirming through regardless.
  const preTaxAmount = previewReady
    ? pricing.pinRequired
      ? (pricing.estimatedPreTax ?? preview.preTaxAmount)
      : preview.preTaxAmount
    : null;
  const { discountAmount, finalAmount, gstAmount, actualPayable, roundingAdjustment, hasDiscount, hasGst } = computeBillingAmounts({
    preTaxAmount: preTaxAmount ?? 0,
    discountApplicable,
    discountPercent,
    gstApplicable,
    gstPercent,
  });
  // Blocks confirming with a half-answered question — the checkbox says "yes, apply a discount"
  // but no usable percent has been typed yet. Same guard shape as blockedLines.length above:
  // the trigger button and the modal's own confirm button share this so an owner can't get from
  // a checked-but-empty state into the modal expecting to just press through it.
  // A location must be chosen AND explicitly confirmed before the confirm button unlocks — same
  // "can't press through a half-answered question" guard the discount/GST fields already use,
  // extended to the fulfilment location. The server enforces both independently; this is the
  // affordance that stops the owner reaching a 400 in the first place.
  //
  // !previewReady is new (rule 113) and is the button-disabling half of "never bill with a
  // previous location's prices": the confirm button stays disabled for the whole window between
  // picking/switching a location and that location's own preview actually resolving, so there is
  // no tick where the owner could press Bill against a stale or wrong-location total.
  //
  // pricing.hasErrors is the same guard applied to rule 113's own inputs: a typed price the server
  // would reject (0, negative, three decimals) must not be pressable through to a 400 on the one
  // irreversible action in the app.
  const billingInputIncomplete =
    (discountApplicable && !hasDiscount) ||
    (gstApplicable && !hasGst) ||
    !fulfillLocationId ||
    !locationConfirmed ||
    !previewReady ||
    pricing.hasErrors;

  return (
    <div className="page">
      {/* tone="tile-red" (2026-08-27) — matches BillOrderList.jsx's own header change and
          Home's Bill Orders tile; see that file's comment for the full reasoning. */}
      <ScreenHeader icon={<InvoiceIcon size={20} />} tone="tile-red" title="Bill Orders" />
      <p className="muted">{order.partyName}</p>
      <span className="badge badge-warning">Packed</span>

      {submitError && (
        <p className="error-banner" role="alert">
          Could not bill this order: {submitError}
        </p>
      )}

      {cancelError && (
        <p className="error-banner" role="alert">
          Could not cancel: {cancelError}
        </p>
      )}

      <div className="card">
        {groups.map((group) => {
          const open = expandedArticles.has(group.productId);
          return (
            <div key={group.productId} className="accordion-section nested">
              <button
                type="button"
                className="accordion-header nested"
                onClick={() => toggleArticle(group.productId)}
                aria-expanded={open}
              >
                <div className="accordion-header-text">
                  <div className="accordion-title-sm">
                    {group.articleNo}
                    <span className="muted"> — {group.productName}</span>
                    {/* One total per article, not per colour line — the sum across this
                        article's non-cancelled lines, at the header level only. */}
                    <span className="muted"> · {formatCurrency(group.total)}</span>
                  </div>
                  {/* Surfaced on the COLLAPSED header specifically, so a blocked line doesn't
                      require expanding every article one by one to find. */}
                  {group.lines.some(isBlocked) && (
                    <div className="accordion-subtitle">
                      <span className="badge badge-danger accordion-low-badge">
                        {group.lines.filter(isBlocked).length} can't be billed
                      </span>
                    </div>
                  )}
                </div>
                <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
              </button>

              {open && (
                <div className="accordion-body nested">
                  {group.lines.map((li) => {
                    // Kept visible, struck through — same "never hard-delete" spirit the rest of
                    // this app applies to archived records.
                    if (li.isCancelled) {
                      return (
                        <div key={li.id} className="bill-line-row bill-line-row-cancelled">
                          <div className="bill-line-main">
                            <span className="pack-line-color-chip">{li.colorName}</span>
                            <span className="badge badge-danger">Cancelled</span>
                          </div>
                        </div>
                      );
                    }
                    const isShort = li.qtySetsPacked < li.qtySetsRequested;
                    const blocked = isBlocked(li);
                    return (
                      <div key={li.id} className={`bill-line-row ${blocked ? 'bill-line-row-blocked' : ''}`}>
                        <div className="bill-line-main">
                          <span className="pack-line-color-chip">{li.colorName}</span>
                          <span className="muted bill-line-qty">
                            {pluralSets(li.qtySetsPacked)}
                            {/* Shown only when they differ, so the owner can see exactly what
                                they're committing to versus what was originally ordered. */}
                            {isShort && (
                              <span className="bill-line-short"> (of {li.qtySetsRequested} ordered)</span>
                            )}
                          </span>
                        </div>
                        {blocked && (
                          <p className="bill-line-blocked-note">
                            Only {availableFor(li)} in stock — cannot bill this line yet.
                          </p>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            className="link-button danger-text line-cancel-link"
                            onClick={() => setCancelTarget({ kind: 'line', line: li })}
                            disabled={submitting || cancelling}
                          >
                            Cancel this line
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky-action-bar">
        <p className="muted pack-order-tally">
          {pluralSets(totalPacked)} packed across {order.lineItems.length} line
          {order.lineItems.length === 1 ? '' : 's'}
          {shortLines > 0 ? ` · ${shortLines} short-packed` : ''}
          {cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ''}
        </p>
        {/* The note sits ABOVE the disabled button, not inside a tooltip or only on the rows —
            a disabled control with no visible reason is its own usability failure. */}
        {blockedLines.length > 0 && (
          <p className="bill-blocked-note">
            {blockedLines.length} line{blockedLines.length === 1 ? "" : "s"} don't have enough stock to bill
            yet — receive stock or adjust the order first.
          </p>
        )}
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setConfirmOpen(true);
            // Second line of defence, alongside the reset already in handleCancelBillConfirm and in
            // handleConfirmBill's non-PIN catch branch: whatever closed the modal last time, opening
            // it again always starts from a clean price/PIN/location-tick review rather than trusting
            // every close path to have already cleared it.
            resetPriceAndLocationReview();
            // Force a fresh preview every time this modal is opened, even if orderId/locationId
            // are unchanged from a previous open on this same page visit — the location choice
            // deliberately persists across a cancelled confirm (see handleCancelBillConfirm), so
            // without this a reopened modal could show a preview fetched minutes ago. Harmless
            // either way for correctness (billOrder's own stale-price check is the real guard),
            // but this keeps what's ON SCREEN honest rather than relying on that check to catch a
            // display the owner is actually looking at. A no-op the first time fulfillLocationId
            // is still null — useFulfillmentPreview only fetches once a location exists.
            refetchPreview();
          }}
          disabled={submitting || blockedLines.length > 0}
        >
          {submitting ? 'Billing…' : 'Bill this order'}
        </button>
        {/* Separated from the primary action for the same reason as on Pack Order: cancelling
            the order and billing it are opposite outcomes and must not sit adjacent as peers. */}
        {canCancel && (
          <button
            type="button"
            className="btn-danger order-cancel-button"
            onClick={() => setCancelTarget({ kind: 'order' })}
            disabled={submitting || cancelling}
          >
            Cancel this order
          </button>
        )}
      </div>

      <ConfirmModal
        open={!!cancelTarget}
        title={cancelTarget?.kind === 'order' ? 'Cancel this whole order?' : 'Cancel this line?'}
        body={
          cancelTarget?.kind === 'order'
            ? `${order.partyName}'s entire order will be cancelled and removed from the billing list. The lines stay on record — nothing is deleted — but the order can't be billed or dispatched afterwards.`
            : `${cancelTarget?.line.colorName} will be cancelled and won't be billed. No stock is deducted for it. The packed quantity stays on record; only the line is marked cancelled.`
        }
        confirmLabel={cancelling ? 'Cancelling…' : cancelTarget?.kind === 'order' ? 'Cancel whole order' : 'Cancel line'}
        tone="danger"
        onConfirm={handleConfirmCancel}
        onCancel={() => setCancelTarget(null)}
      />

      {/* Deliberately heavier copy than any other confirm in this app — this is the only action
          in the whole lifecycle that can't be undone, and it does two separate irreversible
          things. Both are named outright rather than summarised as "are you sure?"

          Discount/GST questions (rule 101) live inside this SAME confirm flow via ConfirmModal's
          `children` — not a second dialog — so the owner answers them right where they're
          already committing to bill, with the real rupee impact visible before they press
          confirm, not only afterward. */}
      <ConfirmModal
        open={confirmOpen}
        title="Bill this order? This cannot be undone."
        body={`This immediately deducts ${pluralSets(totalPacked)} from live stock, and permanently locks ${order.partyName}'s order — no quantity, price or packing change is possible after this, ever. There is no way to reverse it.`}
        // Rule 113 turns this into a TWO-STEP confirm whenever a price was changed: this button
        // stages the PIN step instead of billing, and PinPrompt's own submit button (which replaces
        // this one — see ConfirmModal's hideConfirm) is what actually bills. With no price changed
        // it is exactly the one-step confirm it has always been. The arrow wrapper on the non-PIN
        // path matters: ConfirmModal calls onConfirm as a click handler, so passing
        // handleConfirmBill bare would hand it the click EVENT as its `pin` argument.
        confirmLabel={
          pricing.pinRequired ? 'Review changes & enter PIN' : submitting ? 'Billing…' : 'Bill and lock order'
        }
        tone="danger"
        onConfirm={pricing.pinRequired ? () => setPinStaged(true) : () => handleConfirmBill()}
        onCancel={handleCancelBillConfirm}
        confirmDisabled={submitting || billingInputIncomplete}
        hideConfirm={pinStaged}
      >
        <div className="bill-pricing-questions">
          {/* Rule 113 — sourced from the fulfillment preview, not priceAtOrder. Three explicit
              states rather than one line that might show a wrong number: no location chosen yet
              (nothing to preview), the fetch in flight (never show a stale or placeholder total —
              same discipline dashboard/Orders.jsx already applies to billPreTaxAmount), and a
              failed fetch (billing is blocked either way — see previewReady — so this says why). */}
          {!fulfillLocationId ? (
            <p className="muted bill-pricing-pretax">Choose a fulfilment location to see the order total.</p>
          ) : previewError ? (
            <p className="error-banner" role="alert">
              Could not load prices for this location: {previewError}
            </p>
          ) : !previewReady ? (
            <p className="muted bill-pricing-pretax">Loading prices for this location…</p>
          ) : (
            <p className="muted bill-pricing-pretax">
              Order total: {formatCurrency(preTaxAmount)}
              {/* Named an estimate only once a typed price is actually in play. Unchanged prices
                  make this the server's own preview figure, which is not an estimate at all. */}
              {pricing.pinRequired ? ' (estimate at your new prices)' : ''}
            </p>
          )}

          {/* Fulfilment location first, above the money questions — it decides which physical
              stock leaves the building, which is the more consequential of the two decisions and
              the one that used to be made invisibly. */}
          <BillFulfillmentPicker
            locationId={fulfillLocationId}
            onLocationChange={setFulfillLocationId}
            confirmed={locationConfirmed}
            onConfirmedChange={setLocationConfirmed}
            onLocationSwitched={handleLocationSwitched}
            previewStatus={previewStatus}
            preview={preview}
            previewError={previewError}
          />

          {/* Rule 113's price review, between the location and the money questions: the location
              decides the baseline these prices start from, and discount/GST then apply on top of
              whatever this settles on. Rendered only once there is a real preview to price against —
              with no preview there are no baselines, so every row would be blank. Inputs are
              disabled on the PIN step so the figures the PIN is about can't shift underneath it;
              "Change prices" below unstages to edit them. */}
          {previewReady && (
            <BillPriceReview
              pricing={pricing}
              onOverrideChange={handleOverrideChange}
              formatCurrency={formatCurrency}
              costStatus={costStatus}
              resetNote={priceResetNote}
              disabled={submitting || pinStaged}
            />
          )}

          {staleNote && (
            <p className="error-banner" role="alert">
              {staleNote}
            </p>
          )}

          {/* The PIN step. PinPrompt (components/PinPrompt.jsx) — the shared component, not a
              hand-copied field — owns the input, the submit button, the in-flight label, and the
              INVALID_PIN "(N attempts remaining)" rendering this action can genuinely hit, which is
              why handleConfirmBill re-throws instead of swallowing a PIN failure. Same "stage the
              other fields, then swap to PinPrompt" shape dashboard/History.jsx and
              dashboard/Parties.jsx already use, since PinPrompt owns its own <form> and cannot be
              merged into a bigger one. */}
          {pinStaged && (
            <div className="bill-pricing-pin">
              <p className="muted hint-text">
                {pricing.changedArticles.length} price
                {pricing.changedArticles.length === 1 ? '' : 's'} changed — enter your PIN to bill at
                the new prices.
              </p>
              <PinPrompt
                submitLabel="Bill and lock order"
                submittingLabel="Billing…"
                autoFocus
                onSubmit={handleConfirmBill}
              />
              <button type="button" className="link-button" onClick={() => setPinStaged(false)}>
                Change prices
              </button>
            </div>
          )}


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
          {hasDiscount && (
            <p className="bill-pricing-line">
              −{formatCurrency(discountAmount)} discount → {formatCurrency(finalAmount)}
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
          {hasGst && <p className="bill-pricing-line">+{formatCurrency(gstAmount)} GST</p>}

          {/* Rule 109's rounding, shown only when it actually did something — the same "omit at exactly 0"
              and explicit-sign convention as the post-billing footer in dashboard/Orders.jsx. This
              is what explains why "Total to bill" is a whole rupee while the lines above it carry
              paise. toFixed(2) rather than formatCurrency, whose toLocaleString('en-IN') defaults to
              3 fraction digits and would render a 0.1653 adjustment as "₹0.165". */}
          {roundingAdjustment !== 0 && (
            <p className="bill-pricing-line">
              Rounding {roundingAdjustment > 0 ? '+' : '−'}₹{Math.abs(roundingAdjustment).toFixed(2)}
            </p>
          )}

          <p className="bill-pricing-final">Total to bill: {formatCurrency(actualPayable)}</p>

          {/* Below the total on purpose: everything above it changes the amount, this doesn't.
              Placing it among the discount/GST controls would imply it participates in the
              arithmetic. Optional — blank is a perfectly normal outcome, and it never blocks the
              confirm button (billingInputIncomplete ignores it entirely). Correctable afterwards
              from the party's billing history if it's mistyped here. */}
          <div className="field bill-no-field">
            <span className="field-label">Bill No. (optional)</span>
            <input
              type="text"
              value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
              placeholder="e.g. INV-2291"
              maxLength={BILL_NO_MAX_LENGTH}
              disabled={submitting}
            />
          </div>
        </div>
      </ConfirmModal>
    </div>
  );
}
