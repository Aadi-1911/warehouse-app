// Location-differentiated pricing resolution (05_BUSINESS_RULES.md rule 111).
//
// THE WHOLE POINT OF THIS FILE is that the "what is this line billed at, here?" decision exists
// exactly once. billOrder and GET /api/orders/:id/fulfillment-preview both answer it, and they
// MUST agree to the rupee — the preview's entire job is telling the owner what the bill will say
// before the irreversible button. Two separately-written copies of that resolution would be two
// copies free to drift, and a drift here means a preview that quotes one number and a bill that
// charges another. Same treatment utils/orderBillingAmounts.js gets for the discount/GST
// arithmetic (rule 108), for the same reason.
//
// === What varies by location, and what doesn't ===
// SELLING price varies: an article can be sold for more at one location than another, and an order
// billed from that location is charged its price. COST does not — the owner clarified on
// 2026-09-25 that an article costs what it costs regardless of where it sits, so every cost site
// reads Product.costPrice directly and nothing in this file deals in cost at all.
//
// === Why the fallback is priceAtOrder, not the current Product.sellingPrice ===
// A line that resolves no location override falls back to its OWN priceAtOrder — the price
// snapshotted when the order was placed. NOT the article's current base price. This is rule 23's
// freeze doing its job: an article repriced between placement and billing must not change what
// this party is charged, which is the entire guarantee priceAtOrder exists to provide. Reading the
// live Product.sellingPrice at billing would quietly undo it for every order in the system, not
// just location-priced ones.

const { piecesPerSetFor } = require('./piecesPerSet');

// The single resolution rule, for one line, stated once.
//
//   0. an at-billing override was given  → the override    (rule 113; beats everything below)
//   1. hasLocationPricing false            → priceAtOrder  (toggle off; nothing else consulted)
//   2. true, no row for the billing location → priceAtOrder  (this location has no override)
//   3. true, row exists, sellingPrice null   → priceAtOrder  (row exists for a cleared override)
//   4. true, row exists, sellingPrice set    → the override  (the only case that differs)
//
// Cases 2 and 3 are deliberately indistinguishable to callers, and deliberately silent — no badge,
// no "using the quoted price" indicator. See LocationPrice's schema comment for why.
//
// NEVER returns null: priceAtOrder is a NOT NULL column, so every line always has a real price to
// fall back to. That is a genuine difference from the pre-2026-09-25 resolver, which could return
// null for an unpriced article and forced every caller to handle it — an order cannot exist with
// an unpriced line, because createOrder rejects one at placement (UNPRICED_PRODUCT).
//
// KEPT AS ONE FUNCTION ON PURPOSE. This comment used to say the at-billing override "sits directly
// on top of this — one more case ahead of case 1 — and nothing else has to move". That is exactly
// what happened on 2026-09-25 when rule 113 landed: case 0 below is the whole of it, and neither
// billOrder nor the preview needed a second resolution path. Kept as a record that the prediction
// was tested rather than merely made.
function resolveBilledUnitPrice({ product, locationPrice, priceAtOrder, override = null }) {
  if (!product) {
    throw new Error('resolveBilledUnitPrice: product is required');
  }
  if (priceAtOrder == null) {
    throw new Error('resolveBilledUnitPrice: priceAtOrder is required — every billed line has one');
  }

  // Case 0 — an explicit at-billing override (rule 113), checked BEFORE the toggle. An owner who
  // typed a price for this bill has made a decision about this bill specifically; the article's
  // location-pricing configuration is what that decision overrides, so consulting it first would
  // invert the precedence. Note this is reached only when billOrder actually passes an override:
  // it validates the value (> 0, ≤ 2dp, article genuinely on this order) and demands a PIN before
  // any of that reaches here. Nothing in this file decides whether an override is ALLOWED, only
  // what it means once it has been.
  if (override != null) return override;

  // Case 1 — the toggle decides everything. Checked FIRST among the configured cases and on its
  // own, so a LocationPrice row left behind from a previous time the toggle was on can never leak
  // back into a price while the article is switched off. That dormant-not-deleted behaviour is the
  // reason the flag exists.
  if (!product.hasLocationPricing) return priceAtOrder;

  // Cases 2 and 3 collapse into one expression: no row, or a row whose sellingPrice is null.
  // Named locationOverride rather than plain `override` since rule 113 added the at-billing
  // `override` parameter above — two genuinely different things, and letting the names collide
  // would make case 0 and case 4 read as if they were the same mechanism.
  const locationOverride = locationPrice ? locationPrice.sellingPrice : null;
  if (locationOverride == null) return priceAtOrder;

  // Case 4.
  return locationOverride;
}

// Convenience lookup for callers holding a whole locationPrices array rather than a pre-filtered
// one. Trivial on its own; it lives here so `.find()` on a relation array isn't hand-written at
// several call sites, each free to get the field name subtly wrong.
//
// Tolerates a missing/undefined array rather than throwing: a caller that legitimately didn't
// select the relation gets null, which resolveBilledUnitPrice then treats as case 2 and falls
// back — the correct answer, not an error.
function findLocationPrice(locationPrices, locationId) {
  if (!Array.isArray(locationPrices)) return null;
  return locationPrices.find((lp) => lp.locationId === locationId) ?? null;
}

// The Prisma `select` fragment every billing-price read needs, narrowed to ONE location in
// Postgres. Exported rather than written out at each call site so the preview and the real bill
// cannot read different fields and then disagree about what they found.
//
// `locationId` is always a real id here — both callers validate the location exists and is active
// before reaching this — so the `where` can be unconditional, unlike the pre-2026-09-25 version
// which had to cope with a by-name lookup that could miss.
// `id` rides along because computeBilledLines keys at-billing overrides by productId (rule 113),
// and because the preview must tell the client which article each line belongs to so the owner can
// change a price per ARTICLE rather than per line. Selected here rather than at each call site for
// the same reason everything else in this fragment is: the preview and the real bill must read the
// identical fields or they can disagree about what they found.
function billingPriceProductSelect(locationId) {
  return {
    id: true,
    hasLocationPricing: true,
    locationPrices: { where: { locationId }, select: { locationId: true, sellingPrice: true } },
  };
}

// THE shared answer to "what does this order bill for, from this location?" — used by billOrder to
// write the real figures and by fulfillment-preview to show them beforehand. Both get the identical
// per-line prices and the identical preTaxAmount because both call this.
//
// `lineItems` must already be filtered to the lines being billed (non-cancelled), and each must
// carry priceAtOrder, qtySetsPacked, and bundle.product with the fields billingPriceProductSelect
// asks for plus isKids/sizes for piecesPerSetFor.
//
// preTaxAmount is qtySetsPacked × piecesPerSet × billedUnitPrice, summed — rule 101's basis
// unchanged in every respect except which unit price it multiplies. Returned alongside the lines
// rather than recomputed by each caller, so the sum and its parts can never disagree.
//
// `overridesByProductId` (rule 113, optional) is a Map<productId, number> of at-billing prices.
// Null/omitted means "no overrides", which is what the preview always passes and what billOrder
// passes for its BASELINE call. billOrder then calls this a SECOND time with the real map to get
// the final prices, and compares the two results to decide whether a PIN is required. Two explicit
// calls rather than one call plus a patch-up loop, deliberately: it makes "the baseline" and "what
// we are about to charge" two separately-named arrays produced by the identical function, so the
// comparison between them is comparing like with like and neither can drift from the other's
// arithmetic. The duplicated work is a map over a handful of lines in memory — no query, no cost
// worth trading correctness for.
//
// The override is applied PER ARTICLE, so every line of that article — every colour — receives it.
// That is rule 113's grain, and it falls out of keying on product.id rather than lineItemId
// without any per-colour logic here.
function computeBilledLines({ lineItems, locationId, overridesByProductId = null }) {
  const lines = lineItems.map((li) => {
    const product = li.bundle.product;
    const override = overridesByProductId ? overridesByProductId.get(product.id) ?? null : null;
    const billedUnitPrice = resolveBilledUnitPrice({
      product,
      locationPrice: findLocationPrice(product.locationPrices, locationId),
      priceAtOrder: li.priceAtOrder,
      override,
    });
    return {
      lineItemId: li.id,
      productId: product.id,
      billedUnitPrice,
      lineTotal: li.qtySetsPacked * piecesPerSetFor(product) * Number(billedUnitPrice),
    };
  });

  const preTaxAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  return { lines, preTaxAmount };
}

// The RETURN-side resolution. Deliberately NOT the same function as resolveBilledUnitPrice above,
// because the fallback differs in kind and merging them would need a flag that hides exactly the
// distinction worth seeing:
//
//   - A billed line falls back to its own priceAtOrder, because it HAS one — a frozen quote given
//     to this party for this order (rule 23).
//   - A return has no such anchor. It is recorded against a party, not an order, so there is no
//     quoted price belonging to it, and the only sane fallback is the article's current base
//     sellingPrice. That is what priceAtReturn has always used.
//
// Returns null when the resolved value is itself null — a genuinely unpriced article (rule 8's
// "pending price") stays unpriced, and createReturn rejects it with UNPRICED_PRODUCT. Coercing
// that to 0 here would silently credit a party nothing for real goods.
function resolveReturnUnitPrice({ product, locationPrice }) {
  if (!product) {
    throw new Error('resolveReturnUnitPrice: product is required');
  }
  if (!product.hasLocationPricing) return product.sellingPrice ?? null;
  const override = locationPrice ? locationPrice.sellingPrice : null;
  if (override == null) return product.sellingPrice ?? null;
  return override;
}

// The ONE location a RETURN prices against. Orders no longer use this — they resolve against the
// location they actually bill from (see computeBilledLines above) — but returns still do, and the
// asymmetry is deliberate rather than an oversight. Rule 111 states it explicitly.
//
// Why returns stay pinned. priceAtReturn feeds the party's totalReturned, which offsets amountDue
// (partyController.js). A Good Return is recorded against a PARTY, not against an order —
// PartyStockReturn has no orderId, and one return can legitimately span goods from several orders
// billed from different locations — so there is no billed price for it to mirror. Pricing it at
// "wherever the stock came back to" would credit a party at Gurgaon's price for goods charged at
// Delhi's, drifting that party's balance for no business reason and leaving no record of why the
// two sides disagreed. A fixed, named location keeps every credit on one stable, explainable
// basis until returns can be linked to the order they came from, which is a separate feature with
// its own schema change.
const RETURN_PRICING_LOCATION_NAME = 'Gurgaon';

// Looked up BY NAME on every call rather than hardcoding an id, matching the convention this
// codebase already uses for the same location elsewhere (BillFulfillmentPicker.jsx's
// DEFAULT_LOCATION_NAME, dashboard/Locations.jsx's default-selection lookup). Nothing guarantees
// a fixed Location id across the Production / preview / test databases, so an id baked in here
// would resolve correctly in exactly one of them.
//
// Returns null when no such Location exists — a fresh or differently-named environment, or a test
// database seeded without it. Null flows on into findLocationPrice, which treats it as "no
// override row", so a return prices at the article's base sellingPrice. That is the correct
// degradation: an environment with no Gurgaon prices returns exactly the way it did before rule
// 111 existed, rather than failing to accept returns at all.
async function getReturnPricingLocationId(prisma) {
  const location = await prisma.location.findFirst({
    where: { name: RETURN_PRICING_LOCATION_NAME },
    select: { id: true },
  });
  return location?.id ?? null;
}

module.exports = {
  resolveBilledUnitPrice,
  resolveReturnUnitPrice,
  findLocationPrice,
  billingPriceProductSelect,
  computeBilledLines,
  getReturnPricingLocationId,
  RETURN_PRICING_LOCATION_NAME,
};
