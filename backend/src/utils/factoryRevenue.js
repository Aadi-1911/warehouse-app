const { piecesPerSetFor } = require('./piecesPerSet');
const { periodToRange, VALID_PERIODS } = require('./revenue');
const { SALE_TRANSACTION_WHERE } = require('./locationRevenue');

// Factory-attributed revenue and sold-vs-sitting split. Sibling module to utils/locationRevenue.js
// — read that file's header first, since this one leans on the same investigation rather than
// repeating it. The one structural difference: factoryId lives permanently on Product itself
// (@@unique([articleNo, factoryId]) makes it a fixed attribute, not something that can vary per
// batch or per Stock row the way locationId does), so there's no per-transaction location-style
// split to worry about — every Transaction for a given product's stock belongs to exactly one
// factory, always. That makes this computation strictly simpler than the location one: a straight
// groupBy on product.factoryId instead of a per-row stock.locationId lookup.
//
// SALE_TRANSACTION_WHERE (imported, not redefined) is locationRevenue.js's own answer to "which
// Transaction rows represent a real sale, at all" — a STOCK_OUT tied to a live order line on a
// live, Billed-or-Shipped order. That definition must never drift between the two modules, so it's
// shared rather than copied.

const SALE_TRANSACTION_SELECT = {
  qtySets: true,
  stock: {
    select: {
      bundle: {
        select: {
          product: {
            select: { factoryId: true, isKids: true, costPrice: true, sizes: { select: { sizeLabel: true, qty: true } } },
          },
        },
      },
    },
  },
  orderLineItem: {
    select: {
      priceAtOrder: true,
      order: { select: { billedAt: true, createdAt: true } },
    },
  },
};

// Same bucketing field revenue.js's revenueDateOf and locationRevenue.js's saleDateOf both use
// (billedAt, falling back to createdAt) — the ORDER's date, not Transaction.createdAt. Kept as its
// own copy rather than imported: this is already a second copy of the identical one-liner in this
// codebase (revenue.js and locationRevenue.js each define their own), an established precedent
// that this trivial a computation isn't worth threading a shared import for.
function saleDateOf(order) {
  return order.billedAt ?? order.createdAt;
}

// Per-factory revenue/cost for BILLED+SHIPPED sales in [from, to). Structurally identical to
// locationRevenue.js's computeSalesByLocation, grouped by product.factoryId instead of
// stock.locationId — see that function's own comments for why this reads Transaction rows
// directly (a parallel calculation) rather than delegating to revenue.js's computeRevenue.
async function computeSalesByFactory(prisma, { from = null, to = null } = {}) {
  const transactions = await prisma.transaction.findMany({
    where: SALE_TRANSACTION_WHERE,
    select: SALE_TRANSACTION_SELECT,
  });

  const byFactory = new Map();
  for (const tx of transactions) {
    const order = tx.orderLineItem.order;
    if (from || to) {
      const at = saleDateOf(order);
      if (from && at < from) continue;
      if (to && at >= to) continue;
    }

    const product = tx.stock.bundle.product;
    const pieces = tx.qtySets * piecesPerSetFor(product);
    const revenue = pieces * Number(tx.orderLineItem.priceAtOrder);
    // Same known limitation locationRevenue.js documents: costPrice is read CURRENT, not
    // snapshotted at sale time (no such field exists for STOCK_OUT), so editing an article's cost
    // price retroactively shifts historical profit here too.
    const cost = pieces * (product.costPrice != null ? Number(product.costPrice) : 0);

    const entry = byFactory.get(product.factoryId) ?? { revenue: 0, cost: 0 };
    entry.revenue += revenue;
    entry.cost += cost;
    byFactory.set(product.factoryId, entry);
  }
  return byFactory;
}

// The actual export: per factory, revenue/cost/profit (period-scoped). Unlike Location, Factory
// has no profitSharePercent field — a factory is a supplier, not a selling partner with a
// negotiated revenue share — so `profit` here is plain gross profit (revenue − cost), not scaled
// by anything.
//
// Includes every Factory row, active or not — same reasoning locationRevenue.js documents for
// archived locations: an inactive factory can still hold real historical Transaction rows, and
// silently dropping it would understate real figures.
async function computeRevenueByFactory(prisma, { from = null, to = null } = {}) {
  const [factories, salesByFactory] = await Promise.all([
    prisma.factory.findMany({ select: { id: true, name: true, isActive: true } }),
    computeSalesByFactory(prisma, { from, to }),
  ]);

  return factories.map((factory) => {
    const sales = salesByFactory.get(factory.id) ?? { revenue: 0, cost: 0 };
    const profit = sales.revenue - sales.cost;
    return {
      factoryId: factory.id,
      factoryName: factory.name,
      isActive: factory.isActive,
      revenue: sales.revenue,
      profit,
    };
  });
}

// Convenience wrapper mirroring locationRevenue.js's locationRevenueForPeriod exactly — period
// name in, per-factory rows + the resolved period label out. Reuses periodToRange directly so this
// module's period vocabulary can never drift from the Overview KPI's, the Parties page's, or the
// Locations page's.
async function factoryRevenueForPeriod(prisma, period, { now = new Date() } = {}) {
  const range = periodToRange(VALID_PERIODS.includes(period) ? period : 'fy', now);
  const factories = await computeRevenueByFactory(prisma, { from: range.from, to: range.to });
  return { period: range.period, label: range.label, factories };
}

// Pieces sold all-time per factory (same sale definition as computeSalesByFactory, summed as
// pieces rather than revenue) versus pieces currently sitting in live Stock for that factory's
// products. Deliberately no period parameter on either side — this is a current-inventory-health
// snapshot ("how much of what this factory has ever supplied is still sitting unsold"), not a
// trend. A stock-heavy but well-performing factory relationship isn't wrong just because a lot of
// its stock was received recently, so there's no window to pick a "wrong" length for.
async function computeSoldVsSittingByFactory(prisma) {
  const [factories, soldTransactions, stockRows] = await Promise.all([
    prisma.factory.findMany({ select: { id: true, name: true, isActive: true } }),
    prisma.transaction.findMany({
      where: SALE_TRANSACTION_WHERE,
      select: {
        qtySets: true,
        stock: {
          select: {
            bundle: {
              select: { product: { select: { factoryId: true, isKids: true, sizes: { select: { sizeLabel: true, qty: true } } } } },
            },
          },
        },
      },
    }),
    prisma.stock.findMany({
      select: {
        qtySets: true,
        bundle: {
          select: { product: { select: { factoryId: true, isKids: true, sizes: { select: { sizeLabel: true, qty: true } } } } },
        },
      },
    }),
  ]);

  const soldByFactory = new Map();
  for (const tx of soldTransactions) {
    const product = tx.stock.bundle.product;
    const pieces = tx.qtySets * piecesPerSetFor(product);
    soldByFactory.set(product.factoryId, (soldByFactory.get(product.factoryId) ?? 0) + pieces);
  }

  const sittingByFactory = new Map();
  for (const row of stockRows) {
    const product = row.bundle.product;
    const pieces = row.qtySets * piecesPerSetFor(product);
    sittingByFactory.set(product.factoryId, (sittingByFactory.get(product.factoryId) ?? 0) + pieces);
  }

  return factories.map((factory) => ({
    factoryId: factory.id,
    factoryName: factory.name,
    isActive: factory.isActive,
    soldPieces: soldByFactory.get(factory.id) ?? 0,
    sittingPieces: sittingByFactory.get(factory.id) ?? 0,
  }));
}

module.exports = { computeRevenueByFactory, factoryRevenueForPeriod, computeSoldVsSittingByFactory };
