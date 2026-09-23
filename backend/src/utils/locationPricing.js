// Location-differentiated pricing resolution (05_BUSINESS_RULES.md rule 111, added 2026-09-23).
//
// THE WHOLE POINT OF THIS FILE is that the four-way branch below exists exactly once. Every call
// site that needs "what does this article cost / sell for, here?" imports resolvePrice and asks;
// none of them re-implements the fallback chain. This is the same treatment
// utils/orderBillingAmounts.js already gets for the discount/GST arithmetic (rule 108), and for
// the same reason: money rules that are copied are money rules that silently diverge, and a
// divergence here means two screens quoting two different prices for the same article at the same
// location with no way to tell which one is right.
//
// === Why a price can differ by location at all ===
// Confirmed as a real business fact 2026-09-23: both halves genuinely vary. Cost varies because
// the factory deal and the transport cost into Delhi differ from Gurgaon's. Selling varies for
// the downstream reason. This REPLACES the assumption previously stated on
// Location.profitSharePercent's schema comment and in utils/locationRevenue.js ("cost price is
// identical regardless of location"), both corrected in the same commit as this file.
//
// === What this file does NOT decide ===
// WHICH location a caller resolves against. That is the caller's question and it has genuinely
// different answers in different places — see the selling-price note in orderController.js for
// why an Order always prices against Gurgaon specifically, while stockController.js resolves
// against each Stock row's own real location. This function takes a locationPrice row (or none)
// and applies the fallback chain to it; it never looks a location up itself.

// The fallback chain, in full. Four cases, three of which land on the Product's own value:
//
//   1. hasLocationPricing false             → product[field]      (the toggle is off; nothing else
//                                                                  is even consulted)
//   2. true, no row for that location       → product[field]      (this location has no override)
//   3. true, row exists, row[field] == null → product[field]      (this location overrides the
//                                                                  OTHER field, not this one)
//   4. true, row exists, row[field] set     → locationPrice[field] (the only case that differs)
//
// Cases 2 and 3 are deliberately indistinguishable to callers, and deliberately silent — no
// badge, no "using base price" indicator. See LocationPrice's schema comment for why.
//
// Returns null when the resolved value is itself null — a genuinely unpriced article (rule 8's
// "pending price") stays unpriced. That null is meaningful and must keep reaching the caller:
// createOrder and createReturn both reject an unpriced article with UNPRICED_PRODUCT, and
// coercing it to 0 here would silently sell stock for nothing.
//
// `field` is 'costPrice' or 'sellingPrice'. Anything else is a programming error, not a runtime
// condition to tolerate — throwing beats returning undefined and letting a bad field name become
// a silent null price several layers downstream.
function resolvePrice({ product, locationPrice, field }) {
  if (field !== 'costPrice' && field !== 'sellingPrice') {
    throw new Error(`resolvePrice: field must be 'costPrice' or 'sellingPrice', got ${JSON.stringify(field)}`);
  }
  if (!product) {
    throw new Error('resolvePrice: product is required');
  }

  // Case 1 — the toggle decides everything. Checked FIRST and on its own, so a LocationPrice row
  // left behind from a previous time the toggle was on can never leak back into a price while the
  // article is switched off. That dormant-not-deleted behaviour is the reason the flag exists.
  if (!product.hasLocationPricing) return product[field] ?? null;

  // Cases 2 and 3 collapse into one expression: no row, or a row whose value for THIS field is
  // null, both fall back. `?? null` on the end normalises an absent Product value to null too, so
  // this function's contract is "a Decimal or null", never undefined.
  const override = locationPrice ? locationPrice[field] : null;
  if (override == null) return product[field] ?? null;

  // Case 4.
  return override;
}

// Convenience lookup for the callers that fetch a product's WHOLE locationPrices array and then
// resolve per row — dashboardController's stockValue KPI and locationRevenue's two aggregations
// all iterate Stock rows spanning several locations, so they cannot push the location into the
// Prisma `where` the way a single-location caller (transactionController) can.
//
// Trivial on its own; it lives here so `.find()` on a relation array isn't hand-written at five
// call sites, each free to get the field name subtly wrong.
//
// Tolerates a missing/undefined array rather than throwing: a caller that legitimately didn't
// select the relation (because the toggle is off for that product) gets null, which resolvePrice
// then treats as case 2 and falls back — the correct answer, not an error.
function findLocationPrice(locationPrices, locationId) {
  if (!Array.isArray(locationPrices)) return null;
  return locationPrices.find((lp) => lp.locationId === locationId) ?? null;
}

// The ONE location an Order or a Return prices against, regardless of where it eventually bills
// from. A locked business decision (rule 111, 2026-09-23), not a placeholder: Gurgaon's selling
// price is the article's selling price for party-facing money, full stop. Delhi's selling-price
// override has no effect on Order/Return pricing at all — that is deliberate, not a gap left to
// fill in later.
//
// Why this is the only workable answer for Orders specifically: an OrderLineItem has no location
// and structurally cannot have one at the moment priceAtOrder is captured. WHICH location
// fulfills a line is chosen by the OWNER at BILLING time (billOrder's required
// locationId + locationConfirmed, 2026-09-07), which is one or two status transitions after the
// price is already snapshotted. Resolving against the real fulfillment location would mean either
// asking STAFF to guess it at order-entry time, or re-reading the price at billing — and that
// second one would break exactly the guarantee priceAtOrder exists to provide, that "a later
// Article Pricing change never retroactively alters what this Party was actually charged". Naming
// one fixed pricing location keeps the quote a party is given at the counter identical to the
// amount they are billed, which is what actually matters to them.
//
// Returns exist here for a related but distinct reason: priceAtReturn feeds the party's
// totalReturned, which offsets amountDue (partyController.js). If a return credited the party at
// a different location's price than the order charged them at, every party balance would drift.
// Pricing both sides against the same fixed location is what keeps them reconcilable.
const ORDER_PRICING_LOCATION_NAME = 'Gurgaon';

// Looked up BY NAME on every call rather than hardcoding an id, matching the convention this
// codebase already uses for the same location elsewhere (BillFulfillmentPicker.jsx's
// DEFAULT_LOCATION_NAME, dashboard/Locations.jsx's default-selection lookup). Nothing guarantees
// a fixed Location id across the Production / preview / test databases, so an id baked in here
// would resolve correctly in exactly one of them.
//
// Returns null when no such Location exists — a fresh or differently-named environment, or a test
// database seeded without it. Null flows on into findLocationPrice, which treats it as "no
// override row", so pricing falls back to Product.sellingPrice for everything. That is the
// correct degradation: an environment with no Gurgaon prices exactly the way it did before rule
// 111 existed, rather than failing to create orders at all.
async function getOrderPricingLocationId(prisma) {
  const location = await prisma.location.findFirst({
    where: { name: ORDER_PRICING_LOCATION_NAME },
    select: { id: true },
  });
  return location?.id ?? null;
}

module.exports = {
  resolvePrice,
  findLocationPrice,
  getOrderPricingLocationId,
  ORDER_PRICING_LOCATION_NAME,
};
