const { PrismaClient } = require('@prisma/client');
const { piecesPerSetFor } = require('../utils/piecesPerSet');
const { revenueForPeriod, VALID_PERIODS } = require('../utils/revenue');

const prisma = new PrismaClient();

// Owner Dashboard — Overview KPIs (07_UI_DESIGN_BRIEF.md §8, 05_BUSINESS_RULES.md rules 56, 69, 98).
//
// OWNER ONLY, and not merely by convention: `stockValue` is derived from Product.costPrice, which
// CLAUDE.md's first non-negotiable rule says must never reach a STAFF request "under any
// circumstance." Note this endpoint returns the TOTAL, never the per-article costPrice it was
// built from — the same reasoning 04_API_SPEC.md gives for the factory payable being owner-only
// (a total plus a quantity staff already know is reverse-engineerable into the unit price).
//
// Everything is computed fresh from live rows on every request. No caching layer, no stored
// aggregates — the same principle rules 60, 81, 96 and 98 already establish for every other
// computed money figure in this system.

// Rule 56's threshold, unified across Live Stock, Pack Order and New Order. Defined once here and
// applied as a database-level filter so this endpoint and Live Stock can't drift apart on what
// "low" means.
const LOW_STOCK_THRESHOLD = 2;

// GET /api/dashboard/overview?revenuePeriod=month|fy|all — OWNER only (👑).
async function getOverview(req, res) {
  const requestedPeriod = VALID_PERIODS.includes(req.query.revenuePeriod)
    ? req.query.revenuePeriod
    : 'fy';

  // Every Stock row with the product data both the value and the piece conversion need. One read
  // serves three KPIs (stock value, sets, pieces) rather than three passes over the same table.
  const stockRows = await prisma.stock.findMany({
    select: {
      bundleId: true,
      qtySets: true,
      bundle: {
        select: {
          product: {
            select: { isKids: true, costPrice: true, sizes: { select: { sizeLabel: true } } },
          },
        },
      },
    },
  });

  let stockValue = 0;
  let setsInStock = 0;
  let piecesInStock = 0;
  // "Distinct article+colour combinations that currently have any Stock row" — a Bundle IS an
  // article+colour pairing, and the same bundle can hold rows at several locations, so this counts
  // unique bundleIds rather than rows.
  const bundlesWithStock = new Set();

  for (const row of stockRows) {
    const product = row.bundle.product;
    const piecesPerSet = piecesPerSetFor(product);
    // costPrice is PER PIECE (confirmed 2026-08-19) — the same basis rule 81 uses for the factory
    // payable, so the two owner-facing money figures agree about what a unit of stock is worth.
    // A null costPrice (article still pending-price) contributes 0 rather than being guessed at.
    const unitCost = product.costPrice != null ? Number(product.costPrice) : 0;

    setsInStock += row.qtySets;
    piecesInStock += row.qtySets * piecesPerSet;
    stockValue += row.qtySets * piecesPerSet * unitCost;
    bundlesWithStock.add(row.bundleId);
  }

  // Open orders: Placed + Packed, excluding cancelled. Its secondary figure is the value still in
  // the pipe, on the same per-piece selling basis as Revenue — the two numbers sit on the same
  // screen, so they must be the same kind of number.
  //
  // This is the canonical "open order" definition — the Owner Dashboard's Orders page (added
  // 2026-08-20) mirrors it exactly via frontend/src/utils/orderStatus.js's isOpenOrder(), to
  // split its own order list into an "Open orders" section and a month-filtered section for
  // everything else. That predicate can't literally import this where-clause (frontend/backend
  // are separate runtimes with no shared code today), so if this where-clause ever changes,
  // isOpenOrder() needs the matching change too — it says as much in its own comment.
  const openOrders = await prisma.order.findMany({
    where: { isCancelled: false, status: { in: ['PLACED', 'PACKED'] } },
    select: {
      lineItems: {
        where: { isCancelled: false },
        select: {
          qtySetsRequested: true,
          priceAtOrder: true,
          bundle: {
            select: { product: { select: { isKids: true, sizes: { select: { sizeLabel: true } } } } },
          },
        },
      },
    },
  });

  const openOrdersValue = openOrders.reduce(
    (total, o) =>
      total +
      o.lineItems.reduce(
        (sum, li) =>
          sum + li.qtySetsRequested * piecesPerSetFor(li.bundle.product) * Number(li.priceAtOrder),
        0
      ),
    0
  );

  // Counted in the database rather than by filtering the rows already fetched above: this is the
  // one KPI whose definition is a shared business rule (56), and expressing it as a real query
  // keeps it readable as that rule rather than as an incidental array filter.
  const lowStockCount = await prisma.stock.count({
    where: { qtySets: { lte: LOW_STOCK_THRESHOLD } },
  });

  const revenue = await revenueForPeriod(prisma, requestedPeriod);

  res.json({
    stockValue,
    setsInStock,
    bundlesWithStock: bundlesWithStock.size,
    piecesInStock,
    openOrdersCount: openOrders.length,
    openOrdersValue,
    lowStockCount,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    revenue: revenue.revenue,
    revenuePeriod: revenue.period,
    revenueLabel: revenue.label,
  });
}

module.exports = { getOverview, LOW_STOCK_THRESHOLD };
