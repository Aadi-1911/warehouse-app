// ONE shared ₹ formatter (T1, docs/REVAMP_PLAN.md §4 B1) — replaces the five byte-identical local
// formatCurrency() copies that used to live in BillOrderDetail.jsx, dashboard/Orders.jsx,
// BillFulfillmentPicker.jsx, pages/ArticlePricing.jsx and dashboard/ArticlePricing.jsx (all five
// were exactly `` `₹${Number(amount).toLocaleString('en-IN')}` ``), plus every caller of
// components/BillPriceReview.jsx (which takes formatCurrency as a prop rather than defining its
// own) and utils/margin.js's computeMargin (same — takes the formatter as a parameter).
//
// Two bugs this fixes that none of those five copies fixed on their own:
//   - toLocaleString('en-IN') with no options defaults to maximumFractionDigits: 3, so a real GST
//     figure like 801.9 rendered as "₹801.9" — one decimal place, inconsistent with the Rounding
//     line right next to it, which was always hand-formatted to exactly 2 ("+₹0.10").
//   - Number(amount).toLocaleString('en-IN') on a negative number keeps JavaScript's own ASCII
//     hyphen-minus ("-"), producing "₹-50" — the ₹ sign ends up on the wrong side of the minus,
//     reading as a typo rather than a negative amount. This formatter prepends a real minus sign
//     (U+2212, "−") BEFORE the ₹ instead: "−₹50".
//
// Two modes, chosen per call site by what's being shown (docs/REVAMP_PLAN.md §4 B1):
//   'price' (default) — prices, margins, table money, per-piece rates. Paise are shown only when
//     the amount actually HAS them: "₹500", "₹562.50", "₹12.34" — never "₹562.5" (the 3-decimal
//     bug above) and never "₹500.00" (a whole price doesn't need trailing zeros to read as whole).
//   'paise' — the live billing-calculation lines only: the discount amount, the GST amount, the
//     Order total/estimate, and the equivalent already-billed Pre-tax total/Discount/GST
//     breakdown on dashboard/Orders.jsx. ALWAYS exactly 2 decimals, so "+₹801.90" reads at the
//     same precision as "Rounding +₹0.10" beside it, not "+₹801.9".
// Total to bill / Amount billed / actualPayable stay in the DEFAULT 'price' mode deliberately —
// they are already a whole rupee (Math.round, rule 109), and 'price' mode's "paise only when
// non-zero" already renders a whole number with no decimals, exactly what every screen showed
// before this file existed. There is no separate 'whole' mode for the same reason (see
// docs/REVAMP_PLAN.md's T1 row: "Mode whole is NOT needed").
//
// Formatting only — this NEVER rounds a value that feeds a calculation. Every figure passed in
// here has already been computed (computeBillingAmounts, computeMargin, a server response); this
// only decides how many of its digits to print and which glyph the sign uses. Rounding to 2dp
// below is solely to answer "does this amount have real paise, once past float noise" for 'price'
// mode's decimal-count decision — toLocaleString does the actual, final rounding for display.
//
// Accepts a number OR the string shape a raw Prisma Decimal arrives as over the wire ("250.5") —
// Number()'d before any arithmetic, same discipline every money read in this codebase already
// follows (computeMargin's own comment states this for its two price arguments).
//
// null/undefined: matches exactly what every one of the five local copies already did for them
// (Number(null) is 0, Number(undefined) is NaN) — not new behaviour, just preserved so swapping
// this in doesn't change what a screen showed for a still-loading/absent figure:
//   formatMoney(null)      -> "₹0"
//   formatMoney(undefined) -> "₹NaN"
// Neither was ever a deliberately designed state (every real call site only ever passes a real
// computed number), so this file doesn't invent new handling for them — it just doesn't change
// what was already on screen.

const MINUS = '−'; // U+2212 "minus sign" — NOT the ASCII hyphen-minus toLocaleString emits.

export function formatMoney(amount, { mode = 'price' } = {}) {
  const value = Number(amount);
  const negative = value < 0; // false for NaN and for -0, same as every local copy this replaces
  const abs = Math.abs(value);

  // 'paise' is always 2dp. 'price' is 2dp only when the amount actually has paise once rounded to
  // 2dp — Number.isInteger on the ROUNDED value (not the raw one) is what stops float noise like
  // 199.99999999999997 from being misread as "has no paise" and printed with 0 decimals.
  const digits = mode === 'paise' ? 2 : Number.isInteger(Math.round(abs * 100) / 100) ? 0 : 2;

  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  return `${negative ? MINUS : ''}₹${formatted}`;
}
