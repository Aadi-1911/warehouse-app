const { piecesPerSetFor } = require('./piecesPerSet');
const { orderValueOf } = require('./orderValue');

// THE single revenue calculation for this system. 05_BUSINESS_RULES.md rule 98 is explicit that
// the Owner Dashboard's Revenue KPI and the Parties page's per-party sales summary must share one
// calculation path — "one calculation path, not five separate ones" — so this module exists to be
// imported by both rather than each screen growing its own copy that drifts.
//
// The Parties page's sales summary (built 2026-08-20) is the first real caller of `partyId`,
// exactly the seam this module wired through in advance.
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

// Month-aligned boundaries for every period the Overview selector and the Parties page's sales
// summary offer. Rule 98 insists these are calendar-month buckets, never a rolling day window:
// "this month" is the whole current calendar month, the financial year is anchored April–March
// (not a rolling twelve), and "Last 6 months" is the sum of the 6 most recent calendar months.
//
// Returns `from`/`to` as real Date boundaries so one comparison path (computeRevenue's own
// from/to check) serves every period, plus the human label the UI shows. `from: null` means
// unbounded (All time).
//
// `custom` is only read when period === 'custom' — the Parties page's From/To month picker.
// Kept as a branch of THIS function rather than a second exported range-builder, per rule 98:
// "the From/To custom range picker uses the exact same month-summation function as the four
// presets — one calculation path, not five separate ones." A custom range is just another
// month-aligned [from, to) pair, computed the same way "this month"'s single-month pair is.
function periodToRange(period, now = new Date(), custom = {}) {
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

  if (period === 'six_months') {
    // The current calendar month plus the 5 before it, expressed as one month-aligned [from, to)
    // range — arithmetically identical to summing 6 separate monthly totals, since every order's
    // revenue date (revenueDateOf) falls inside exactly one of those months either way. Using a
    // single range keeps this one call to computeRevenue instead of 6.
    const startOffset = month - 5;
    const startYear = year + Math.floor(startOffset / 12);
    const startMonth = ((startOffset % 12) + 12) % 12;
    const from = new Date(startYear, startMonth, 1, 0, 0, 0, 0);
    const to = new Date(year, month + 1, 1, 0, 0, 0, 0);
    return {
      period,
      from,
      to,
      label: `${from.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} – ${now.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`,
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

  if (period === 'custom') {
    const { fromYear, fromMonth, toYear, toMonth } = custom;
    // A caller reaching this branch with an incomplete/malformed `custom` (e.g. a bare
    // ?period=custom with no month fields — the controller is expected to reject that with a 400
    // before ever calling this, but this function shouldn't silently hand back an unbounded
    // all-time figure mislabelled as a custom range if that validation is ever skipped) falls
    // back to the same unbounded 'all' shape an unrecognised period gets below.
    if (![fromYear, fromMonth, toYear, toMonth].every(Number.isInteger)) {
      return { period: 'all', from: null, to: null, label: 'All time' };
    }
    const from = new Date(fromYear, fromMonth, 1, 0, 0, 0, 0);
    // Same "+1 month, exclusive end" shape as every other branch above — the To month is
    // included in full, not cut off partway through.
    const to = new Date(toYear, toMonth + 1, 1, 0, 0, 0, 0);
    const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    return { period, from, to, label: `${monthLabel(fromYear, fromMonth)} – ${monthLabel(toYear, toMonth)}` };
  }

  return { period: 'all', from: null, to: null, label: 'All time' };
}

const VALID_PERIODS = ['month', 'six_months', 'fy', 'all', 'custom'];

// Everything a revenue line needs, in one place, so a caller can't accidentally select a
// different shape and get a different answer.
const REVENUE_ORDER_SELECT = {
  billedAt: true,
  createdAt: true,
  // The rule 101 billing snapshot, so each order can contribute the REAL amount owed when it has
  // one (rule 103). Must be selected here or orderValueOf would see undefined on every order and
  // fall back forever — the aggregate would stay quietly pre-tax with nothing to indicate it.
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
    // Per ORDER, never per call: one party's all-time total legitimately mixes orders billed
    // after rule 101 (real actualPayable snapshot, discount/GST inclusive) with orders billed
    // before it or not yet billed (no snapshot, line-item sum). Both are correct — they just
    // have different authoritative sources, and the fallback below is untouched.
    return (
      total +
      orderValueOf(
        order,
        order.lineItems.reduce(
          (sum, li) =>
            sum + li.qtySetsRequested * piecesPerSetFor(li.bundle.product) * Number(li.priceAtOrder),
          0
        )
      )
    );
  }, 0);
}

// Convenience wrapper: period name in, figure + label out. The Overview KPI calls this with one of
// the three named periods; the Parties page's sales summary calls it with a partyId for all five
// (including 'custom', passing `custom: { fromYear, fromMonth, toYear, toMonth }` — the caller is
// responsible for validating those before calling, same as any other request input).
async function revenueForPeriod(prisma, period, { partyId = null, now = new Date(), custom = {} } = {}) {
  const range = periodToRange(VALID_PERIODS.includes(period) ? period : 'fy', now, custom);
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
