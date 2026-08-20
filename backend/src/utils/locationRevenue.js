const { piecesPerSetFor } = require('./piecesPerSet');
const { REVENUE_STATUSES, periodToRange, VALID_PERIODS } = require('./revenue');

// Location-attributed revenue/profit split (05_BUSINESS_RULES.md rule 98's basis, extended
// per-location; task added 2026-08-20). Read the investigation notes below before changing
// anything here — this module's shape is a direct consequence of two things confirmed against
// real Transaction rows in the dev DB, not assumptions.
//
// === INVESTIGATION 1: does billOrder's deduction leave per-location Transaction rows? ===
// Yes, confirmed directly (not just by reading billOrder's code) against a real SHIPPED order
// (Ashiyana, 5 lines, each qtySetsPacked: 2) whose FIFO deduction genuinely spanned two
// locations: EVERY line produced exactly 2 separate Transaction rows — one `qtySets: 1` at
// Delhi, one `qtySets: 1` at Gurgaon — each with its own `stockId` (hence its own location via
// `stock.locationId`) and the SAME `orderLineItemId` linking both back to that line's single
// `priceAtOrder`. So yes: a single order line's deduction across two locations leaves two
// genuinely distinguishable Transaction rows, at exactly the granularity this split needs.
//
// === INVESTIGATION 2: does revenue.js's per-ORDER-LINE function fit a per-location split? ===
// No — and this isn't bent to fit anyway, on purpose. utils/revenue.js's computeRevenue sums
// `qtySetsRequested` (the ORDERED amount) across OrderLineItem rows; it never touches Transaction
// or location at all, because whole-business revenue doesn't need to know where stock came from.
// A location split fundamentally needs per-TRANSACTION granularity instead, for two reasons:
//   1. Location only exists on Stock (via Transaction.stockId), never on OrderLineItem — an order
//      line has no location of its own once it's split across two.
//   2. UNIT MISMATCH, worth stating plainly: Transaction.qtySets reflects what was actually
//      DEDUCTED, which derives from qtySetsPacked (what really got billed), not
//      qtySetsRequested (what was ordered). These are the same only when a line was never
//      short-packed — true for every real order in the dev DB today (checked directly: zero
//      requested/packed mismatches across every BILLED/SHIPPED line), but not true in general.
//      A consequence worth flagging rather than burying: summing this module's per-location
//      revenue across every location will NOT necessarily reconcile to revenue.js's whole-business
//      Revenue KPI the moment a real short-pack happens on a billed order, because the two
//      figures are computed from different base quantities. That's not a bug to fix here — the
//      two figures are answering different questions (what was ordered vs. what actually moved)
//      — but a future dashboard putting both numbers on one screen should not assume they always
//      match.
// So: this module computes its own per-transaction revenue/cost/profit directly from Transaction
// + its linked OrderLineItem (for priceAtOrder) + its linked Stock (for locationId and the
// product, for costPrice/piecesPerSet) — a parallel calculation, not a wrapper around
// computeRevenue. It DOES reuse revenue.js's REVENUE_STATUSES, periodToRange and VALID_PERIODS —
// "which statuses count" and "how a period name becomes a date range" are unaffected by the
// per-line vs. per-transaction distinction above, so those stay genuinely shared.

// Which Transaction rows represent a real sale, at all: a STOCK_OUT tied to a live order line on
// a live, Billed-or-Shipped order. (A cancelled order can never reach Billed/Shipped — rule 23 —
// so `order.isCancelled: false` here is defensive/explicit rather than something that can
// currently exclude a row; kept for the same reason orderController's own defensive checks are:
// stated, not assumed.)
const SALE_TRANSACTION_WHERE = {
  type: 'STOCK_OUT',
  orderLineItemId: { not: null },
  orderLineItem: {
    isCancelled: false,
    order: { isCancelled: false, status: { in: REVENUE_STATUSES } },
  },
};

const SALE_TRANSACTION_SELECT = {
  qtySets: true,
  stock: {
    select: {
      locationId: true,
      bundle: {
        select: { product: { select: { isKids: true, costPrice: true, sizes: { select: { sizeLabel: true } } } } },
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

// Same bucketing field revenue.js's revenueDateOf uses (billedAt, falling back to createdAt) —
// the ORDER's date, not Transaction.createdAt. All of an order's STOCK_OUT rows are written in
// the same DB transaction as the billedAt stamp itself (see billOrder), so the two are for all
// practical purposes simultaneous; using the order's own billedAt keeps this on the identical
// "what counts as the sale date" convention rule 98 already established, rather than a second,
// merely-very-close one.
function saleDateOf(order) {
  return order.billedAt ?? order.createdAt;
}

// Per-location stock value — the SAME three-factor computation dashboardController.js's Overview
// stockValue KPI already uses (qtySets × piecesPerSet × costPrice), just grouped by locationId
// instead of summed into one global figure. Not period-filtered: like the Overview KPI, this is a
// live "right now" snapshot, not a historical figure — the task is explicit that no split logic
// is needed here since Stock rows already carry locationId directly.
async function computeStockValueByLocation(prisma) {
  const stockRows = await prisma.stock.findMany({
    select: {
      locationId: true,
      qtySets: true,
      bundle: { select: { product: { select: { isKids: true, costPrice: true, sizes: { select: { sizeLabel: true } } } } } },
    },
  });

  const byLocation = new Map();
  for (const row of stockRows) {
    const product = row.bundle.product;
    const unitCost = product.costPrice != null ? Number(product.costPrice) : 0;
    const value = row.qtySets * piecesPerSetFor(product) * unitCost;
    byLocation.set(row.locationId, (byLocation.get(row.locationId) ?? 0) + value);
  }
  return byLocation;
}

// Per-location revenue/cost/profit for BILLED+SHIPPED sales in [from, to). See the investigation
// notes above for why this reads Transaction rows directly rather than calling computeRevenue.
async function computeSalesByLocation(prisma, { from = null, to = null } = {}) {
  const transactions = await prisma.transaction.findMany({
    where: SALE_TRANSACTION_WHERE,
    select: SALE_TRANSACTION_SELECT,
  });

  const byLocation = new Map();
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
    // Same known limitation revenue.js already documents for piecesPerSet, extended here to
    // costPrice: neither is snapshotted at transaction time (no such field exists for STOCK_OUT —
    // Transaction.costPriceSnapshot is populated only for STOCK_IN), so this reads the product's
    // CURRENT cost price. Editing an article's cost price retroactively shifts historical profit,
    // same pre-existing tradeoff as the factory payable and revenue.js's own piecesPerSet caveat.
    const cost = pieces * (product.costPrice != null ? Number(product.costPrice) : 0);

    const locationId = tx.stock.locationId;
    const entry = byLocation.get(locationId) ?? { revenue: 0, cost: 0 };
    entry.revenue += revenue;
    entry.cost += cost;
    byLocation.set(locationId, entry);
  }
  return byLocation;
}

// The actual export: per location, stock value (live) + revenue/cost/profit (period-scoped).
// Profit is (revenue − cost) × profitSharePercent/100 — cost price itself never changes by
// location (rule stated on the Location.profitSharePercent schema field), only the business's
// share of the resulting profit does.
//
// Includes every Location row, active or not — an archived location can still hold real Stock
// and real historical Transaction rows, and silently dropping those would understate the
// business's real figures. `isActive` rides along in the response so a caller can choose to
// filter/display differently; this module doesn't decide that.
async function computeLocationRevenue(prisma, { from = null, to = null } = {}) {
  const [locations, stockValueByLocation, salesByLocation] = await Promise.all([
    prisma.location.findMany({ select: { id: true, name: true, isActive: true, profitSharePercent: true } }),
    computeStockValueByLocation(prisma),
    computeSalesByLocation(prisma, { from, to }),
  ]);

  return locations.map((loc) => {
    const stockValue = stockValueByLocation.get(loc.id) ?? 0;
    const sales = salesByLocation.get(loc.id) ?? { revenue: 0, cost: 0 };
    const grossProfit = sales.revenue - sales.cost;
    const profit = grossProfit * (loc.profitSharePercent / 100);
    return {
      locationId: loc.id,
      locationName: loc.name,
      isActive: loc.isActive,
      profitSharePercent: loc.profitSharePercent,
      stockValue,
      revenue: sales.revenue,
      profit,
    };
  });
}

// Convenience wrapper mirroring revenue.js's revenueForPeriod exactly — period name in, per-
// location rows + the resolved period label out. Reuses periodToRange directly rather than a
// second period-name-to-date-range implementation, so this module's period vocabulary (month /
// six_months / fy / all / custom) can never drift from the Overview KPI's or the Parties page's.
async function locationRevenueForPeriod(prisma, period, { now = new Date(), custom = {} } = {}) {
  const range = periodToRange(VALID_PERIODS.includes(period) ? period : 'fy', now, custom);
  const locations = await computeLocationRevenue(prisma, { from: range.from, to: range.to });
  return { period: range.period, label: range.label, locations };
}

module.exports = { computeLocationRevenue, locationRevenueForPeriod };
