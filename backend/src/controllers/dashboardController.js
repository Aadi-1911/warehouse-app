const { PrismaClient } = require('@prisma/client');
const { piecesPerSetFor } = require('../utils/piecesPerSet');
const { revenueForPeriod, VALID_PERIODS } = require('../utils/revenue');
const { orderValueOf } = require('../utils/orderValue');

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
//
// Lowered from 2 to 1 on 2026-08-26 (a deliberate rule change). This is the BACKEND copy; the
// frontend keeps its own in utils/lowStock.js because the two codebases share no constants
// package (same reason piecesPerSet is duplicated). They must always be changed together — this
// one decides the Overview KPI's count and the `lowStockThreshold` the API reports, while the
// frontend one decides every badge; a mismatch shows up as the KPI disagreeing with the screens.
const LOW_STOCK_THRESHOLD = 1;

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
            select: { isKids: true, costPrice: true, sizes: { select: { sizeLabel: true, qty: true } } },
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

  // Shared select/reduce shape for the two status-scoped money KPIs below — same fields
  // revenue.js's REVENUE_ORDER_SELECT uses, and the same fallback shape orderController.js's
  // listOrders totalValue uses (qtySetsRequested x piecesPerSet x priceAtOrder, cancelled line
  // items excluded). `orderValueOf` (rule 103) prefers the real actualPayable snapshot when one
  // exists and falls back to this live sum otherwise.
  const MONEY_ORDER_SELECT = {
    actualPayable: true,
    lineItems: {
      where: { isCancelled: false },
      select: {
        qtySetsRequested: true,
        priceAtOrder: true,
        bundle: {
          select: { product: { select: { isKids: true, sizes: { select: { sizeLabel: true, qty: true } } } } },
        },
      },
    },
  };

  function sumOrderValue(orders) {
    return orders.reduce(
      (total, o) =>
        total +
        orderValueOf(
          o,
          o.lineItems.reduce(
            (sum, li) => sum + li.qtySetsRequested * piecesPerSetFor(li.bundle.product) * Number(li.priceAtOrder),
            0
          )
        ),
      0
    );
  }

  // Billed not shipped: money already claimed (billed) but not yet out the door. Same isCancelled
  // exclusion the old Open Orders KPI used (`isCancelled: false` on the order itself, plus
  // cancelled line items excluded inside MONEY_ORDER_SELECT) — a cancelled order can't be BILLED
  // anyway (rule 23 locks a billed order before cancellation could apply), so this is belt-and-
  // braces consistency with every other status-scoped query here, not a real-world case.
  const billedNotShipped = await prisma.order.findMany({
    where: { isCancelled: false, status: 'BILLED' },
    select: MONEY_ORDER_SELECT,
  });
  const billedNotShippedValue = sumOrderValue(billedNotShipped);

  // Packed not billed: stock already deducted (packing does that), payment not yet claimed. Every
  // order reachable here is pre-billing, so actualPayable is null by construction and orderValueOf
  // always takes the live line-item fallback — routed through the same shared helper as
  // billedNotShipped anyway, so both cards stay on one calculation path (rule 103's own framing:
  // the preference is decided per order, never assumed per screen).
  const packedNotBilled = await prisma.order.findMany({
    where: { isCancelled: false, status: 'PACKED' },
    select: MONEY_ORDER_SELECT,
  });
  const packedNotBilledValue = sumOrderValue(packedNotBilled);

  // Orders this week: a plain volume count, Monday-start calendar week, computed in local server
  // time (matching revenue.js's periodToRange, which also builds boundaries with the local
  // `new Date(year, month, day, ...)` constructor rather than UTC). Deliberately NOT filtered by
  // isCancelled: an unfiltered order query is a general/reporting count in this codebase, not a
  // worklist — orderController.js's listOrders only excludes cancelled orders when a `status`
  // filter scopes the query to an actionable worklist (its own comment: "an unfiltered GET
  // /api/orders is a general query (History, reporting) and still returns everything"), and this
  // KPI is exactly that kind of general count, not a to-do list.
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday ... 6 = Saturday
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon->0, Tue->1, ..., Sun->6
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0, 0, 0);
  const ordersThisWeek = await prisma.order.count({
    where: { createdAt: { gte: weekStart } },
  });

  // Counted in the database rather than by filtering the rows already fetched above: this is the
  // one KPI whose definition is a shared business rule (56), and expressing it as a real query
  // keeps it readable as that rule rather than as an incidental array filter.
  //
  // bundle.product.isActive: true excludes archived articles (2026-08-28, confirmed by Aadi) —
  // this is a genuinely separate query from GET /api/stock (stockController.js), not a shared
  // source, so fixing the two Low Stock SCREENS' own client-side filters alone would have left
  // this KPI card showing a higher, stale-feeling number than what either list actually displays.
  // Deliberately NOT the same call as stockValue/setsInStock/piecesInStock just above, which stay
  // unfiltered on purpose (rule 85 extended to reporting — archived stock is still real value).
  // This KPI is a different kind of number: an action prompt ("go restock this"), not a valuation,
  // and an archived article — hidden from the daily receiving/ordering pickers by definition —
  // isn't something anyone would act on from this nag, so it's excluded here specifically.
  const lowStockCount = await prisma.stock.count({
    where: { qtySets: { lte: LOW_STOCK_THRESHOLD }, bundle: { product: { isActive: true } } },
  });

  const revenue = await revenueForPeriod(prisma, requestedPeriod);

  res.json({
    stockValue,
    setsInStock,
    bundlesWithStock: bundlesWithStock.size,
    piecesInStock,
    billedNotShippedCount: billedNotShipped.length,
    billedNotShippedValue,
    packedNotBilledCount: packedNotBilled.length,
    packedNotBilledValue,
    ordersThisWeek,
    lowStockCount,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    revenue: revenue.revenue,
    revenuePeriod: revenue.period,
    revenueLabel: revenue.label,
  });
}

module.exports = { getOverview, LOW_STOCK_THRESHOLD };
