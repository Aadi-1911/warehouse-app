const { piecesPerSetFor } = require('./piecesPerSet');

// THE single revenue calculation for this system. 05_BUSINESS_RULES.md rule 98 is explicit that
// the Owner Dashboard's Revenue KPI and the Parties page's per-party sales summary must share one
// calculation path — "one calculation path, not five separate ones" — so this module exists to be
// imported by both rather than each screen growing its own copy that drifts.
//
// The Parties page isn't built yet. `partyId` below is the seam it will use; it is deliberately
// wired through and tested now, while the reasoning is fresh, rather than retrofitted later.
//
// BASIS (rule 98, rule 69): only BILLED and SHIPPED orders count. A Placed or Packed order is a
// promise, not money — including it would let revenue fall when an order is cancelled, which is
// exactly the kind of figure an owner stops trusting. Cancelled orders and cancelled line items
// are excluded on both axes.
const REVENUE_STATUSES = ['BILLED', 'SHIPPED'];

// WHICH DATE BUCKETS A SALE (assumption, stated rather than buried): `billedAt`. Rule 98 requires
// month-bucketing but doesn't name the field, and a SHIPPED order carries both billedAt and
// shippedAt. Billing is when the money is actually claimed, and it's the stable choice — an order
// shipping in a later month must not silently move revenue out of the month it was billed in.
// Falls back to createdAt only if billedAt is somehow null (defensive; the Placed→Packed→Billed
// chain always sets it), so a row can never be silently dropped from every period at once.
function revenueDateOf(order) {
  return order.billedAt ?? order.createdAt;
}

// Month-aligned boundaries for the three periods the Overview's selector offers. Rule 98 insists
// these are calendar-month buckets, never a rolling day window: "this month" is the whole current
// calendar month, and the financial year is anchored April–March, not a rolling twelve.
//
// Returns `from`/`to` as real Date boundaries so one comparison path serves every period, plus the
// human label the UI shows. `from: null` means unbounded (All time).
function periodToRange(period, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  if (period === 'month') {
    return {
      period,
      from: new Date(year, month, 1, 0, 0, 0, 0),
      to: new Date(year, month + 1, 1, 0, 0, 0, 0),
      label: now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    };
  }

  if (period === 'fy') {
    // April–March. Before April we're still in the FY that opened the previous April.
    const fyStartYear = month >= 3 ? year : year - 1;
    const shortStart = String(fyStartYear).slice(2);
    const shortEnd = String(fyStartYear + 1).slice(2);
    return {
      period,
      from: new Date(fyStartYear, 3, 1, 0, 0, 0, 0),
      to: new Date(fyStartYear + 1, 3, 1, 0, 0, 0, 0),
      label: `FY ${shortStart}–${shortEnd}`,
    };
  }

  return { period: 'all', from: null, to: null, label: 'All time' };
}

const VALID_PERIODS = ['month', 'fy', 'all'];

// Everything a revenue line needs, in one place, so a caller can't accidentally select a
// different shape and get a different answer.
const REVENUE_ORDER_SELECT = {
  billedAt: true,
  createdAt: true,
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
};

// Computed fresh from live rows on every call — no caching anywhere, same principle rules 60, 81,
// 96 and 98 all already establish for this project's other money figures.
//
// PRICE UNIT: priceAtOrder snapshots Product.sellingPrice, which is stored PER PIECE (confirmed
// 2026-08-19). So a line is worth qtySetsRequested × piecesPerSet × priceAtOrder — the same
// three-factor shape the factory payable uses on the cost side (rule 81), now on the selling side.
//
// Known limitation, worth stating: piecesPerSet is read from the product's CURRENT ProductSize
// rows, not snapshotted at order time (no such field exists). Editing an article's size list would
// therefore retroactively shift historical revenue. That's pre-existing behaviour shared with the
// factory payable calculation, not something introduced here.
async function computeRevenue(prisma, { from = null, to = null, partyId = null } = {}) {
  const where = {
    isCancelled: false,
    status: { in: REVENUE_STATUSES },
  };
  if (partyId) where.partyId = partyId;

  const orders = await prisma.order.findMany({ where, select: REVENUE_ORDER_SELECT });

  // The date filter is applied in JS rather than SQL because the bucketing field is derived
  // (billedAt with a createdAt fallback), which a single Prisma `where` can't express. At this
  // business's real volume the whole Order table is trivially small; if that ever stopped being
  // true, the fix is a stored/normalised billing date, not a second divergent query.
  return orders.reduce((total, order) => {
    if (from || to) {
      const at = revenueDateOf(order);
      if (from && at < from) return total;
      if (to && at >= to) return total;
    }
    return (
      total +
      order.lineItems.reduce(
        (sum, li) =>
          sum + li.qtySetsRequested * piecesPerSetFor(li.bundle.product) * Number(li.priceAtOrder),
        0
      )
    );
  }, 0);
}

// Convenience wrapper: period name in, figure + label out. The Overview KPI calls this; the future
// Parties page can call it with a partyId, or call computeRevenue directly with a custom month
// range for its From/To picker — either way it lands on the same arithmetic.
async function revenueForPeriod(prisma, period, { partyId = null, now = new Date() } = {}) {
  const range = periodToRange(VALID_PERIODS.includes(period) ? period : 'fy', now);
  const revenue = await computeRevenue(prisma, { from: range.from, to: range.to, partyId });
  return { ...range, revenue };
}

module.exports = {
  REVENUE_STATUSES,
  VALID_PERIODS,
  periodToRange,
  computeRevenue,
  revenueForPeriod,
};
