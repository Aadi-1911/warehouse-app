import { piecesPerSetFor } from './piecesPerSet';

// Shared by both real billing entry points — BillOrderDetail.jsx (mobile) and dashboard/
// Orders.jsx's "Mark billed" flow — so the live discount/GST preview each shows can never
// silently drift apart for the same order. Added 2026-08-25 alongside the backend's own
// preTaxAmount/finalAmount/actualPayable snapshot fields on Order (03_DATABASE_SCHEMA.md,
// 05_BUSINESS_RULES.md rule 101) — this is a LIVE PREVIEW ONLY. The server independently
// recomputes and stores the authoritative figures inside billOrder() itself; nothing computed
// here is ever trusted as the value that gets written.

// NO LONGER CALLED BY EITHER BILLING SCREEN (rule 113, 2026-09-25). This computed the pre-tax
// total from each line's priceAtOrder — the price the party was QUOTED at order time — but billing
// now charges billedUnitPrice, which can legitimately differ once an article has a location-level
// selling override (rule 111) or an at-billing price change (rule 113, entered through
// components/BillPriceReview.jsx on both billing screens). Using this for the confirm-screen
// total would show a figure the bill might not actually charge. Both screens now read
// `preTaxAmount` directly from GET /api/orders/:id/fulfillment-preview instead —
// the SAME resolver billOrder() itself uses, so what's shown and what's charged cannot disagree.
// Kept rather than deleted: a grep at the time of this change found no remaining callers anywhere
// in frontend/src, but removing an exported function is a separate, deliberate cleanup task, not a
// side effect of this one.
export function preBillingTotal(lineItems) {
  return lineItems
    .filter((li) => !li.isCancelled)
    .reduce(
      (sum, li) =>
        sum + li.qtySetsPacked * piecesPerSetFor({ isKids: li.productIsKids, sizes: li.productSizes }) * Number(li.priceAtOrder),
      0,
    );
}

// The exact calculation rules 101 and 109 define — GST is applied to the POST-discount amount,
// never the original preTaxAmount, and only then is the payable rounded to the whole rupee.
// Returns 0s for anything not yet computable (e.g. a percent field still empty) rather than NaN,
// so a caller can render the result directly without its own guard.
//
// The three money expressions below (finalAmount, actualPayableRaw, and the rounding) are
// character-for-character the same as backend/src/utils/orderBillingAmounts.js's — same operations
// in the same ORDER — and that is deliberate, not tidiness. This function used to write the
// discount as `pre * (pct / 100)`; the backend writes `pre - (pre * pct) / 100`. On paper those are
// equal, but in floating point "divide first" and "multiply first" round off different digits: a
// sweep found the raw finalAmount differing in ~2% of cases (e.g. 211.39 at 15% gives
// 179.68149999999997 on the server and 179.6815 here). Rounded to a rupee the two happened to
// agree in every sampled case, but a raw figure sitting within ~1e-14 of an exact .5 could round to
// a different rupee, so the safe rule is: same expressions, so they cannot disagree by construction.
// If they ever do differ, the backend's is right (see its header) — change THIS file to match.
//
// The input guards (Number(), ''/null/NaN mean "not entered yet") stay frontend-only because the
// server receives validated numbers while this reads raw form strings.
//
// Rule 109 rounding (added 2026-09-28): before this, the confirm screens showed the RAW figure
// (e.g. ₹3,359.88) while the server billed the rounded one (₹3,360). `actualPayable` is now the
// ROUNDED figure — the amount that will actually be billed — and `actualPayableRaw` keeps the
// unrounded one, which is what the GST line must be derived from (same reasoning as the
// post-billing footer in dashboard/Orders.jsx: subtracting from the rounded figure would fold the
// rounding into the GST).
//
// discountAmount and gstAmount are DERIVED from the backend-ordered totals, never computed by their
// own multiplication: discountAmount = preTaxAmount − finalAmount, gstAmount = actualPayableRaw −
// finalAmount. That guarantees the lines on screen always add up to the totals shown beside them.
export function computeBillingAmounts({ preTaxAmount, discountApplicable, discountPercent, gstApplicable, gstPercent }) {
  const discountPct = Number(discountPercent);
  const hasDiscount = discountApplicable && discountPercent !== '' && discountPercent != null && !Number.isNaN(discountPct);
  const finalAmount = hasDiscount ? preTaxAmount - (preTaxAmount * discountPct) / 100 : preTaxAmount;
  const discountAmount = preTaxAmount - finalAmount;

  const gstPct = Number(gstPercent);
  const hasGst = gstApplicable && gstPercent !== '' && gstPercent != null && !Number.isNaN(gstPct);
  const actualPayableRaw = hasGst ? finalAmount + (finalAmount * gstPct) / 100 : finalAmount;
  const gstAmount = actualPayableRaw - finalAmount;

  // Rule 109 — identical to the backend: Math.round (half up), and the delta as (rounded − raw)
  // normalised with toFixed(8) to strip float noise (see the backend's comment for why 8).
  const actualPayable = Math.round(actualPayableRaw);
  const roundingAdjustment = Number((actualPayable - actualPayableRaw).toFixed(8));

  return { discountAmount, finalAmount, gstAmount, actualPayable, actualPayableRaw, roundingAdjustment, hasDiscount, hasGst };
}

// Hard clamp client-side (0..max) for the discountPercent/gstPercent onChange handlers in both
// billing entry points — same discipline PackOrderDetail.jsx's packed-quantity stepper already
// uses (stepAdjust: Math.max(0, Math.min(ordered, ...))): the backend REJECTS an out-of-range
// percent rather than clamping it (billOrder() returns 400 VALIDATION_ERROR), so the input itself
// must never be able to produce one in the first place. This closes a real gap found in
// investigation: a number input's `min`/`max` attributes only constrain the spinner arrows, not
// raw keyboard/paste input, so typing "-5" reached computeBillingAmounts() above unclamped and
// rendered a nonsensical preview (a negative discountAmount, so a "discounted" total higher than
// the pre-tax amount).
//
// Passes the raw string through UNCHANGED whenever it doesn't yet parse to a number — an empty
// field, or a transient state mid-typing like "-" or "5." (Number("5.") is 5, not NaN, so a
// trailing decimal point survives; only a genuinely unparseable string like "-" hits this branch).
// Without this, reformatting a valid in-range value via String(Number(value)) would strip the "."
// the instant it's typed, making it impossible to ever type a decimal like "5.10" one keystroke
// at a time — computeBillingAmounts() already treats a not-yet-parseable value as "not entered
// yet" (hasDiscount/hasGst check discountPercent/gstPercent !== '' && !Number.isNaN(...)), so
// letting it through here doesn't risk a bad value reaching the preview or the server.
export function clampPercent(rawValue, max) {
  if (rawValue === '') return '';
  const num = Number(rawValue);
  if (Number.isNaN(num)) return rawValue;
  if (num < 0) return '0';
  if (num > max) return String(max);
  return rawValue;
}

// The seenPrices echo the backend now REQUIRES on every bill (rule 113, 2026-09-25) — the per-line
// prices the fulfillment preview showed, sent back so the server can refuse to bill at a figure the
// owner never actually saw (409 PRICES_CHANGED). Built from exactly the preview object that's on
// screen, never recomputed or guessed — the request must describe what the owner was SHOWN, not
// what the client thinks the price should be. `preview.lines` is already scoped by the server to
// the lines a bill would actually deduct (non-cancelled, qtySetsPacked > 0), so no filtering is
// needed here.
export function seenPricesFromPreview(preview) {
  return preview.lines.map((l) => ({ lineItemId: l.lineItemId, unitPrice: Number(l.billedUnitPrice) }));
}

// Turns a 409 PRICES_CHANGED response's `changedLines` (04_API_SPEC.md: `[{ lineItemId, articleNo,
// productName, colorName, shown, current }]`) into one line of copy per changed article/colour.
// Takes a `formatCurrency` function rather than formatting money itself, so this stays free of any
// screen's own currency-display convention — both BillOrderDetail.jsx and dashboard/Orders.jsx
// already have their own local formatCurrency and this reuses whichever one is calling.
//
// `shown === null` is a real, distinct case documented by the backend (orderController.js's
// staleLines comment): it means the line wasn't part of the preview the owner last looked at at
// all — e.g. it went from qtySetsPacked 0 to packed, becoming billable only after that preview was
// taken. That is not "a price moved," so it gets its own sentence rather than a nonsensical
// "null is now ₹X".
export function describeChangedLines(changedLines, formatCurrency) {
  return changedLines.map((l) => {
    const label = [l.productName, l.colorName].filter(Boolean).join(' ') || l.articleNo || 'A line';
    if (l.shown == null) {
      return `${label}: wasn't part of your last review — now ${formatCurrency(l.current)}`;
    }
    return `${label}: ${formatCurrency(l.shown)} is now ${formatCurrency(l.current)}`;
  });
}
