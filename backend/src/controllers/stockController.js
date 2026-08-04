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
      qtyReservedForSample: true,
      bundle: {
        select: {
          product: { select: { articleNo: true } },
          color: { select: { name: true } },
        },
      },
      location: { select: { name: true } },
    },
  });

  // Flatten the joined shape to exactly what 04_API_SPEC.md specifies — the Live Stock View
  // gets display-ready rows, not nested relation objects it would have to unpack itself.
  const response = stock.map((s) => ({
    bundleId: s.bundleId,
    productArticleNo: s.bundle.product.articleNo,
    colorName: s.bundle.color.name,
    locationId: s.locationId,
    locationName: s.location.name,
    qtySets: s.qtySets,
    qtyReservedForSample: s.qtyReservedForSample,
  }));

  res.json(response);
}

module.exports = { listStock };
