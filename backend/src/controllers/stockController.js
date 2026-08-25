const { PrismaClient } = require('@prisma/client');

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
            select: { id: true, articleNo: true, name: true, factoryId: true, factory: { select: { name: true } } },
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
  const response = stock.map((s) => ({
    bundleId: s.bundleId,
    productId: s.bundle.product.id,
    productArticleNo: s.bundle.product.articleNo,
    productName: s.bundle.product.name,
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
