// Shared margin helper — the ONE implementation of "how do we show margin" for every place that
// shows it: the base price row and every per-location row, on both the desktop and mobile
// Article Pricing screens (rule 111's per-location selling price). Written once, here, so the
// two screens can never quietly disagree about what "margin" means — the same discipline
// orderBillingAmounts.js/resolveBilledUnitPrice already apply to money math elsewhere in this app.
//
// MARGIN IS ON SELLING PRICE, NOT COST. (350 cost, 500 selling) -> ₹150 margin, and the PERCENT
// is 150 ÷ 500 = 30%, not 150 ÷ 350 = 42.9% — that second number is MARKUP, a different question
// ("how much did we add on top of cost") from margin ("what share of the sale is profit"). This
// is a deliberate, final Owner decision for this task, not a default either formula would have
// been equally valid to pick.
//
// Takes `formatCurrency` as a parameter rather than formatting money itself — the same shape
// utils/orderBilling.js's describeChangedLines() already uses, because every caller of this
// already keeps its own local formatCurrency (BillOrderDetail.jsx, FactoryPayables.jsx, both
// ArticlePricing.jsx files, ...) rather than sharing one import for it, and this reuses whichever
// one is calling instead of introducing a second, competing money formatter.
//
// Returns "—" for rupees AND percent TOGETHER, never one without the other. A case that can't
// honestly support a percent — no cost recorded, no selling price recorded (pending), or a
// selling price of 0 — can't honestly support a rupee figure either: showing ₹150 next to a "—"
// percent (or the reverse) would let a reader infer a computation this function never actually
// did. costPrice/sellingPrice may be a number OR the string a raw Prisma Decimal arrives as
// ("250.50") — both are Number()'d before any arithmetic, same discipline every other money read
// in this codebase already follows.
export function computeMargin(costPrice, sellingPrice, formatCurrency) {
  const cost = costPrice == null ? null : Number(costPrice);
  const selling = sellingPrice == null ? null : Number(sellingPrice);

  // cost missing, selling missing (pending), or selling <= 0 (the "pending"/invalid cases this
  // helper is required to treat identically — a selling price of 0 should never occur past
  // validation elsewhere, but this function doesn't trust that and stays defensive on its own).
  if (cost == null || selling == null || !Number.isFinite(cost) || !Number.isFinite(selling) || selling <= 0) {
    return { rupees: '—', percent: '—' };
  }

  const marginRupees = selling - cost;
  const marginPercent = (marginRupees / selling) * 100;

  return {
    // Rounded to the nearest whole percent — this app shows no other figure to fractional
    // precision the Owner asked for by name, and the task's own worked example (350, 500 -> 30%)
    // is a whole number, so there's no existing convention here to match more finely than that.
    rupees: formatCurrency(marginRupees),
    percent: `${Math.round(marginPercent)}%`,
  };
}
