// Rule 101's discount-then-GST arithmetic, in ONE place.
//
// Extracted from billOrder() on 2026-09-08, when the post-billing correction endpoint (rule 105,
// PATCH /api/orders/:id/billing-correction) needed the identical calculation. The alternative —
// writing the same three lines a second time in the correction controller — is exactly the shape
// of mistake this codebase has already logged a lesson about: `checkLocationAvailability()` is
// shared between the fulfilment preview and the real deduction specifically so a future edit
// cannot make the two disagree. Money arithmetic deserves that treatment at least as much, and
// more so here, because the two callers write to the SAME columns on the SAME row: if they ever
// diverged, an order's stored actualPayable would depend on which endpoint last touched it.
//
// Deliberately a pure function of its inputs — no Prisma client, no order lookup, no rounding, no
// currency formatting. Callers pass a real preTaxAmount they already hold and get back the two
// derived figures. Keeping it pure is what makes it directly unit-testable without a database and
// what stops it quietly acquiring a second responsibility later.
//
// ROUNDING IS DELIBERATELY ABSENT, matching billOrder()'s original behaviour byte-for-byte. The
// pre-existing code stored the raw floating-point result (a 5%-discount-then-5%-GST order on
// 18,200 stores 18,154.50, and rule 103 quotes that exact figure from real production data), and
// this extraction is explicitly NOT the place to change that — introducing rounding here would
// silently alter what every future billing writes, which is a separate decision needing its own
// task and its own verification against existing rows.
//
// The ORDER of the two steps is the rule, not a detail: discount comes off preTaxAmount first,
// then GST applies to the POST-discount figure — never to the original preTaxAmount. Rule 101
// states it, 04_API_SPEC.md restates it, and the frontend's own live preview
// (frontend/src/utils/orderBilling.js's computeBillingAmounts) mirrors it for display only.
// That frontend copy is a SEPARATE, display-only implementation and is not this function — the
// server never trusts a client-computed figure (see billOrder's own comment), so the duplication
// is intentional and one-directional: if these two ever disagree, this one is right.
function computeBillingAmounts({ preTaxAmount, discountApplicable, discountPercent, gstApplicable, gstPercent }) {
  // Step 1 — discount off the pre-tax amount. `discountApplicable` is the gate, not a non-null
  // percent: an order can carry a stale percent with the flag false (billOrder nulls the percent
  // on write precisely to prevent that, but a pre-rule-101 row or a future caller might not), and
  // the flag is what rule 101 defines as authoritative.
  const finalAmount = discountApplicable ? preTaxAmount - (preTaxAmount * discountPercent) / 100 : preTaxAmount;

  // Step 2 — GST on the POST-discount amount. Reading `finalAmount` here, never `preTaxAmount`,
  // is the whole substance of rule 101's ordering requirement.
  const actualPayable = gstApplicable ? finalAmount + (finalAmount * gstPercent) / 100 : finalAmount;

  return { finalAmount, actualPayable };
}

module.exports = { computeBillingAmounts };
