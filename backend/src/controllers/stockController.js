const { PrismaClient } = require('@prisma/client');
const { findLocationPrice } = require('../utils/locationPricing');

const prisma = new PrismaClient();

// GET /api/stock — any authenticated role (🔒). Read-only: no direct write endpoint exists for
// Stock by design (04_API_SPEC.md) — quantities only ever change via POST /api/transactions.
async function listStock(req, res) {
  const { articleNo, colorId, locationId } = req.query;

  const where = {};
  if (locationId) where.locationId = locationId;
  if (colorId) where.bundle = { ...(where.bundle || {}), colorId };
  if (articleNo) {
    where.bundle = {
      ...(where.bundle || {}),
      product: { articleNo: { contains: articleNo, mode: 'insensitive' } },
    };
  }

  const stock = await prisma.stock.findMany({
    where,
    select: {
      bundleId: true,
      locationId: true,
      qtySets: true,
      bundle: {
        select: {
          product: {
            select: {
              id: true,
              articleNo: true,
              name: true,
              factoryId: true,
              isActive: true,
              sellingPrice: true,
              // Rule 111. Unfiltered — this endpoint returns rows for every location at once, so
              // the per-row match happens in JS below.
              //
              // No cost field appears anywhere in this select, at any role, which is the standing
              // requirement for this endpoint: GET /api/stock is ANY-ROLE and must never put cost
              // price in front of STAFF. Product.costPrice has always been excluded here;
              // LocationPrice carried a costPrice column between 2026-09-23 and 2026-09-25 which
              // was likewise never selected, and since the 2026-09-25 revision made cost global
              // that column no longer exists at all.
              hasLocationPricing: true,
              locationPrices: { select: { locationId: true, sellingPrice: true } },
              factory: { select: { name: true } },
            },
          },
          color: { select: { name: true } },
        },
      },
      location: { select: { name: true } },
    },
  });

  // Flatten the joined shape to exactly what 04_API_SPEC.md specifies — the Live Stock View
  // gets display-ready rows, not nested relation objects it would have to unpack itself.
  // productId rides along too: articleNo alone can't be joined back to a specific Product
  // safely, since article numbers are only unique per Factory, never globally (CLAUDE.md's
  // non-negotiable rule) — matching by the bare string would silently misattribute stock to
  // the wrong Factory the moment two Factories share an article number.
  //
  // factoryId/factoryName ride along too — added for Transfer's Factory-grouped picker
  // (07_UI_DESIGN_BRIEF.md §5.9 amendment). Selected directly here rather than making Transfer
  // do its own separate listProducts()/listFactories() join the way LiveStock.jsx does, since
  // every consumer of this endpoint needs a Location→Factory→Article→Colour hierarchy sooner
  // or later and the join is already sitting right here. Purely additive — existing callers
  // that don't reference these two fields are unaffected.
  //
  // productName rides along too — added so the Low Stock screens can show "ArticleNo — Name" the
  // same way Pack/Bill/Ship Order already do, instead of a bare article number. Product.name has
  // no role-sensitivity (unlike costPrice/sellingPrice, which live on the same model but are never
  // selected here), so no gating question to weigh — just another additive field.
  //
  // productIsActive rides along too (2026-08-28), for Live Stock's archived section and for the
  // stock-aware archive warning in Article Pricing. Note what did NOT change: this endpoint has
  // never filtered on Product.isActive and still doesn't. An archived article sitting on real,
  // unsold inventory is still real stock and must keep reaching every caller — the Owner
  // Dashboard's stock-value/sets/pieces KPIs read the Stock table directly and likewise never
  // filtered it, so archiving has always been non-destructive for reporting. What was actually
  // missing was not a filter but a FLAG: callers received archived stock rows already and had no
  // way to tell them apart from active ones, so they could neither separate them (Live Stock)
  // nor warn about them (Article Pricing). Exposing the flag is what makes that possible without
  // hiding anything from anyone.
  //
  // Deliberately named productIsActive, not isActive: every other product field on this flattened
  // row already carries the `product` prefix (productId, productArticleNo, productName), and a
  // bare `isActive` here would read as a property of the Stock row itself, which has no such
  // concept.
  //
  // productSellingPrice rides along too (2026-09-02), for the Owner Dashboard's Live Stock page —
  // OWNER-only route, so no STAFF-visibility question to weigh (unlike costPrice, which this
  // endpoint must never select regardless of caller, since GET /api/stock is any-role). Nullable,
  // same as on Product itself ("pending price" until the owner sets one).
  const response = stock.map((s) => ({
    bundleId: s.bundleId,
    productId: s.bundle.product.id,
    productArticleNo: s.bundle.product.articleNo,
    productName: s.bundle.product.name,
    productIsActive: s.bundle.product.isActive,
    // Rule 111 — resolved against THIS row's own location. A Stock row IS a
    // per-bundle-per-location quantity, so it already knows the location its price question is
    // about, and the answer is simply "what does this pile of stock, here, sell for" — exactly
    // what the Owner Dashboard's Live Stock page asks of it.
    //
    // Between 2026-09-23 and 2026-09-25 this was the codebase's one location-aware selling-price
    // site, because orders were pinned to a fixed named location. That pinning is gone: an order
    // now bills at its own billing location's price too, so this is the normal case rather than
    // an exception.
    //
    // Still NOT the price a given order was or would be written at, and nothing should treat it as
    // such — an order line carries its own frozen priceAtOrder and, once billed, its own
    // billedUnitPrice. This field is about stock on a shelf, not about any order.
    //
    // The inline fallback rather than a shared resolver: resolveBilledUnitPrice falls back to a
    // line's priceAtOrder, which a Stock row has no equivalent of, and resolveReturnUnitPrice is
    // named for a different question. Both would read as the wrong thing here.
    productSellingPrice: (() => {
      const p = s.bundle.product;
      if (!p.hasLocationPricing) return p.sellingPrice ?? null;
      const override = findLocationPrice(p.locationPrices, s.locationId)?.sellingPrice ?? null;
      return override ?? p.sellingPrice ?? null;
    })(),
    factoryId: s.bundle.product.factoryId,
    factoryName: s.bundle.product.factory.name,
    colorName: s.bundle.color.name,
    locationId: s.locationId,
    locationName: s.location.name,
    qtySets: s.qtySets,
  }));

  res.json(response);
}

module.exports = { listStock };
