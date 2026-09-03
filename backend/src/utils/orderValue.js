// Which number an order is actually WORTH, when it's shown to someone or summed into a total.
//
// This codebase accumulated three different "order value" calculations, and the third one made
// the first two wrong to display on their own:
//   1. listOrders' totalValue        — qtySetsRequested × piecesPerSet × priceAtOrder
//   2. BillOrderDetail's group.total — the same shape but qtySetsPacked-based (the pre-billing
//                                      screen, where packed quantity is authoritative)
//   3. Order.actualPayable           — a REAL server-computed snapshot written once at billing
//                                      (rule 101, 2026-08-25), already discount- and GST-inclusive
//
// (1) and (2) both compute a PRE-TAX, PRE-DISCOUNT figure from live line items. That was the only
// thing available before rule 101, and it stays correct for orders that have no snapshot. But for
// an order billed after rule 101, the real amount owed was already computed server-side and
// stored — and showing the line-item sum instead silently displays the wrong money. That was a
// live bug on real production data: SAI's order cmt8g9w4p001bbtsf44ek2g66 displayed Rs.61,200
// while the stored, correct actualPayable was Rs.64,260.
//
// Crucially this is NOT "add GST to the old number" — it's "prefer the real stored value", and it
// moves in BOTH directions. An order with a 5% discount and 5% GST (cmt4gw3xa002lbtfocfyvoeyy)
// has actualPayable 18,154.50 against a pre-tax 18,200 — the discount outweighs the GST, so the
// correct figure is LOWER. Anything that special-cased "billed means bigger" would be wrong here.
//
// The decision is strictly PER ORDER, never per screen: a single party's payables list, or one
// aggregate sum, will legitimately mix orders that have a snapshot with orders that don't (billed
// before rule 101 shipped, or not yet billed at all). Both kinds are correct; they just have
// different authoritative sources.
//
// `fallback` is passed as a value, not computed here, precisely because the two callers'
// fallbacks are genuinely different calculations and both are already correct for the orders that
// need them — this function decides WHICH source wins, and deliberately never redefines what the
// pre-rule-101 answer is.
function orderValueOf(order, fallback) {
  // Decimal columns arrive as Prisma Decimal objects, not JS numbers — Number() is required, and
  // a `?? fallback` alone would not be enough since a Decimal of 0 is a real, valid snapshot.
  return order.actualPayable != null ? Number(order.actualPayable) : fallback;
}

module.exports = { orderValueOf };
