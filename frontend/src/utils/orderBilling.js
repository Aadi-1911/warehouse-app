import { piecesPerSetFor } from './piecesPerSet';

// Shared by both real billing entry points — BillOrderDetail.jsx (mobile) and dashboard/
// Orders.jsx's "Mark billed" flow — so the live discount/GST preview each shows can never
// silently drift apart for the same order. Added 2026-08-25 alongside the backend's own
// preTaxAmount/finalAmount/actualPayable snapshot fields on Order (03_DATABASE_SCHEMA.md,
// 05_BUSINESS_RULES.md rule 101) — this is a LIVE PREVIEW ONLY. The server independently
// recomputes and stores the authoritative figures inside billOrder() itself; nothing computed
// here is ever trusted as the value that gets written.

// The order's pre-tax billed total — qtySetsPacked, deliberately NOT qtySetsRequested, because
// billing commits against what was actually packed (BillOrderDetail.jsx's own established basis
// for this exact screen, predating this task; rule 101 restates it explicitly for billOrder()
// itself). A short-packed line is billed for what's really going out, not what was originally
// asked for. Cancelled lines contribute nothing.
export function preBillingTotal(lineItems) {
  return lineItems
    .filter((li) => !li.isCancelled)
    .reduce(
      (sum, li) =>
        sum + li.qtySetsPacked * piecesPerSetFor({ isKids: li.productIsKids, sizes: li.productSizes }) * Number(li.priceAtOrder),
      0,
    );
}

// The exact three-step calculation order rule 101 defines — GST is applied to the
// POST-discount amount, never the original preTaxAmount. Returns 0s for anything not yet
// computable (e.g. a percent field still empty) rather than NaN, so a caller can render the
// result directly without its own guard.
export function computeBillingAmounts({ preTaxAmount, discountApplicable, discountPercent, gstApplicable, gstPercent }) {
  const discountPct = Number(discountPercent);
  const hasDiscount = discountApplicable && discountPercent !== '' && discountPercent != null && !Number.isNaN(discountPct);
  const discountAmount = hasDiscount ? preTaxAmount * (discountPct / 100) : 0;
  const finalAmount = hasDiscount ? preTaxAmount - discountAmount : preTaxAmount;

  const gstPct = Number(gstPercent);
  const hasGst = gstApplicable && gstPercent !== '' && gstPercent != null && !Number.isNaN(gstPct);
  const gstAmount = hasGst ? finalAmount * (gstPct / 100) : 0;
  const actualPayable = hasGst ? finalAmount + gstAmount : finalAmount;

  return { discountAmount, finalAmount, gstAmount, actualPayable, hasDiscount, hasGst };
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
