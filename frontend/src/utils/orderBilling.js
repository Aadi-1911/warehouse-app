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
