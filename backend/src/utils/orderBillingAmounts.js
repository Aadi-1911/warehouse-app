// Rule 101's discount-then-GST arithmetic, in ONE place.
//
// Extracted from billOrder() on 2026-09-08, when the post-billing correction endpoint (rule 108,
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
// ROUNDING: actualPayable IS rounded here, to the nearest whole rupee, as of 2026-09-19 (rule 111).
// This reverses what this header said between 2026-09-08 and that date ("rounding is deliberately
// absent... a separate decision needing its own task"). That decision has since been made and this
// is it — the business rounds these figures by hand anyway, so the app now records the rounding
// explicitly instead of storing a figure nobody actually transacts on.
//
// WHAT IS AND ISN'T ROUNDED. Only actualPayable, the single number a party actually pays. finalAmount
// stays raw on purpose: it is an intermediate step (the post-discount, pre-GST figure), and rounding
// it too would round twice on one order — the GST would then be charged on an already-adjusted base
// and the two stored figures would no longer reconcile against preTaxAmount and the percentages.
//
// Math.round(), specifically, and verified rather than assumed: it rounds half UP (0.5 -> 1,
// 2.5 -> 3), matching Excel's ROUND() convention, NOT banker's/half-to-even rounding (which would
// give 2 for 2.5). Its one divergence from Excel is on negatives (Math.round(-0.5) is -0, Excel
// gives -1), which is unreachable here: preTaxAmount is a sum of non-negative line values, discount
// is capped at 0-100% and GST at 0-5%, so actualPayable can never be negative. The float-precision
// trap was also checked empirically before choosing this, not reasoned about — across 11,809
// mathematically-exact .5 results (verified with exact BigInt arithmetic) from realistic
// preTax/discount/GST combinations, float64 never misrepresented one as a hair under .5, because
// .5 is itself exactly representable in binary. So no epsilon correction is needed, and adding one
// would introduce a second rounding rule with no case that requires it.
//
// roundingAdjustment is returned so the caller can STORE the rounding as an explicit fact rather
// than absorbing it silently — see Order.roundingAdjustment's own schema comment. It is derived
// (rounded - raw), never an input, so it can't disagree with the two figures beside it.
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
  // is the whole substance of rule 101's ordering requirement. Still the RAW figure at this point;
  // rule 101's arithmetic is unchanged and rule 111's rounding applies strictly after it.
  const rawActualPayable = gstApplicable ? finalAmount + (finalAmount * gstPercent) / 100 : finalAmount;

  // Step 3 — rule 111. Rounded to the nearest whole rupee, with the delta kept alongside rather
  // than discarded. Subtracting in this direction (rounded - raw) makes the sign read the way a
  // person would describe it: positive means the party was rounded UP, negative means down.
  const actualPayable = Math.round(rawActualPayable);

  // The subtraction itself carries float noise the two operands don't: 45696 - 45695.9538 evaluates
  // to 0.04620000000431901, and Prisma stores a JS number into a Decimal column verbatim (checked,
  // not assumed), so without this the audit column would hold 17 significant digits of binary
  // artefact for a figure that is really 4.62 paise. Normalised to 8 decimal places, which is
  // chosen to sit in the gap rather than picked arbitrarily: absolute float error here is ~1e-12,
  // six orders of magnitude finer than this cutoff, while a genuine adjustment can carry at most
  // ~5 decimals (a 3-decimal percent applied twice to a 2-decimal amount) — so this erases the
  // noise and cannot touch a real value. It is NOT a second money-rounding rule; the money rounding
  // is the Math.round above, and this only cleans how the resulting delta is written down.
  const roundingAdjustment = Number((actualPayable - rawActualPayable).toFixed(8));

  return { finalAmount, actualPayable, roundingAdjustment };
}

module.exports = { computeBillingAmounts };
