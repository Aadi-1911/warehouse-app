const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
const { revenueForPeriod, computeRevenue, VALID_PERIODS } = require('../utils/revenue');
const { piecesPerSetFor } = require('../utils/piecesPerSet');

const prisma = new PrismaClient();

// Every scalar field on Party (03_DATABASE_SCHEMA.md's minimal Phase 1 form) except createdAt
// and runningDueBalance (a computed figure, never a direct field a caller reads off this
// record — see getPartyPayable/computeRevenue) — matches the shape Factory/Color/Location's own
// SELECTs use (public fields + isActive), same convention even though Party has no create/list
// endpoint yet to establish one independently. tier added 2026-09-02 alongside updateParty below
// — until now nothing read or wrote it, so it had never been selected anywhere.
const SELECT = {
  id: true,
  name: true,
  shopName: true,
  location: true,
  address: true,
  contact: true,
  gstNo: true,
  tier: true,
  isActive: true,
};

// GET /api/parties — any authenticated role (🔒), matching Location/Factory/Color's own GET
// gating. No isActive filtering here — same convention as every other archived entity: the
// response always includes isActive, and hiding archived records from daily pickers is a
// frontend concern, not a server-side one. This keeps "hidden from pickers" and "fully
// accessible when needed" (rule 85) both true from one unfiltered endpoint.
async function listParties(req, res) {
  const parties = await prisma.party.findMany({ select: SELECT });
  res.json(parties);
}

// POST /api/parties — OWNER only (👑), per an explicit decision made when this task was scoped:
// unlike Factory/Color/Category (open to any role), Party is treated like Location — a
// customer/shop-relationship record, not a casual lookup list. Case-insensitive uniqueness on
// name mirrors Color/Category/Location's own pattern (pre-check + P2002 catch as backup for the
// exact-case race the pre-check alone can't fully close).
//
// One real gap, worth flagging rather than quietly matching in name only: Color.name and the
// newer Factory.name both carry a DB-level `@unique` index, so their P2002 catch is a genuine
// backstop. Party.name has NO such index in schema.prisma — nothing currently in this codebase
// enforces it below the application layer. The P2002 catch below is kept anyway (harmless, and
// it starts doing real work the moment a unique index is added), but as of this task the
// pre-check is the only defense that actually exists; two POSTs for the same name landing in
// the same race window could both succeed. Not fixed here — adding a DB constraint is a schema
// migration, outside this task's scope of "build the endpoints."
async function createParty(req, res) {
  const { name, shopName, location, address, contact, gstNo } = req.body;
  if (!name || !name.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  }
  const trimmed = name.trim();

  const existing = await prisma.party.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) {
    return sendError(res, 409, 'DUPLICATE_PARTY', `Party "${existing.name}" already exists`);
  }

  try {
    const party = await prisma.party.create({
      data: {
        name: trimmed,
        shopName: shopName?.trim() || null,
        location: location?.trim() || null,
        address: address?.trim() || null,
        contact: contact?.trim() || null,
        gstNo: gstNo?.trim() || null,
      },
      select: SELECT,
    });
    res.status(201).json(party);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_PARTY', `Party "${trimmed}" already exists`);
    }
    throw err;
  }
}

// Mirrors GoodReturnReason/TransactionCorrectionReason's own "kept as a plain array, not
// imported from Prisma's generated enum" convention (returnController.js) — a bad `tier`
// produces a clean 400 with the valid values listed, instead of a raw Prisma error surfacing as
// a 500.
const VALID_TIERS = ['REGULAR', 'ONE_OFF'];

// PATCH /api/parties/:id — OWNER only (👑), no PIN — mirrors updateFactory's exact gating and
// shape (factoryController.js): editing a Party's own details (name, contact, address, tier) is
// administrative, not the pricing-adjacent action the PIN gate exists to protect (rule 71 is
// about costPrice/sellingPrice specifically, which don't exist on this model at all).
//
// Editable fields are every scalar on Party except the three the application computes/derives
// rather than a person typing them in: id, isActive (owns its own deactivate/reactivate
// endpoints below, a different action with a different blast radius — same split
// updateFactory/deactivateFactory already draw), runningDueBalance (computed from Order history,
// never a direct write), and createdAt.
//
// Case-insensitive duplicate-name pre-check, same as updateFactory — but unlike Factory.name,
// Party.name carries NO DB-level @unique index (flagged explicitly in createParty's own comment
// above), so the P2002 catch below is kept only as defense-in-depth for whenever that index is
// eventually added; today, the pre-check is genuinely the only defense that exists, and two
// concurrent renames to the same name could both still succeed in the same race window.
async function updateParty(req, res) {
  const { id } = req.params;
  const body = req.body;

  const data = {};
  if ('name' in body) data.name = body.name;
  if ('shopName' in body) data.shopName = body.shopName;
  if ('location' in body) data.location = body.location;
  if ('address' in body) data.address = body.address;
  if ('contact' in body) data.contact = body.contact;
  if ('gstNo' in body) data.gstNo = body.gstNo;
  if ('tier' in body) data.tier = body.tier;

  if (Object.keys(data).length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'No editable fields provided');
  }
  if ('name' in data && (!data.name || !String(data.name).trim())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name cannot be empty');
  }
  if ('tier' in data && data.tier !== null && !VALID_TIERS.includes(data.tier)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `tier must be one of: ${VALID_TIERS.join(', ')}, or null`);
  }

  const existing = await prisma.party.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${id}`);
  }

  if ('name' in data) {
    data.name = String(data.name).trim();
    const nameClash = await prisma.party.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, id: { not: id } },
    });
    if (nameClash) {
      return sendError(res, 409, 'DUPLICATE_PARTY', `Party "${nameClash.name}" already exists`);
    }
  }
  // Optional text fields: trimmed, and an empty string normalised to null so "not provided" and
  // "cleared" both end up as the same value — same convention createParty already uses.
  if ('shopName' in data) data.shopName = data.shopName?.trim() || null;
  if ('location' in data) data.location = data.location?.trim() || null;
  if ('address' in data) data.address = data.address?.trim() || null;
  if ('contact' in data) data.contact = data.contact?.trim() || null;
  if ('gstNo' in data) data.gstNo = data.gstNo?.trim() || null;

  try {
    const updated = await prisma.party.update({ where: { id }, data, select: SELECT });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_PARTY', `Party "${data.name}" already exists`);
    }
    throw err;
  }
}

// PATCH /api/parties/:id/deactivate — OWNER only (👑), matching createParty's own gating.
// Soft-deactivate only, NEVER hard-delete — Transaction/PartyStockReturn rows reference partyId
// and must stay resolvable forever, same principle as User.isActive. Idempotent: deactivating an
// already-inactive party just re-confirms the state, not an error. No lockout-prevention guard
// (unlike userController's deactivateUser) — that pair exists specifically because the system
// must never reach zero active OWNER accounts; a Party has no equivalent structural risk.
async function deactivateParty(req, res) {
  const { id } = req.params;

  const existing = await prisma.party.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${id}`);
  }

  const party = await prisma.party.update({ where: { id }, data: { isActive: false }, select: SELECT });
  res.json(party);
}

// PATCH /api/parties/:id/reactivate — OWNER only (👑). Reverses a deactivation.
async function reactivateParty(req, res) {
  const { id } = req.params;

  const existing = await prisma.party.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${id}`);
  }

  const party = await prisma.party.update({ where: { id }, data: { isActive: true }, select: SELECT });
  res.json(party);
}

// GET /api/parties/:id/revenue?period=month|six_months|fy|all — OWNER only (👑), matching the
// Owner Dashboard Overview revenue endpoint's own gating: same figure (utils/revenue.js's
// computeRevenue, rule 98's "one calculation path"), just scoped to one party via the partyId
// param that module already had wired through and unused until this page.
//
// Custom range: ?period=custom&from=YYYY-MM&to=YYYY-MM. Validated here (a well-formed month
// string, `to` not before `from`) before ever reaching revenueForPeriod/periodToRange — those
// trust their caller, this is the boundary that actually faces request input.
const MONTH_PARAM_RE = /^(\d{4})-(\d{2})$/;

function parseMonthParam(value) {
  const match = MONTH_PARAM_RE.exec(value || '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1; // to 0-indexed
  if (month < 0 || month > 11) return null;
  return { year, month };
}

async function getPartyRevenue(req, res) {
  const { id } = req.params;

  const party = await prisma.party.findUnique({ where: { id }, select: { id: true } });
  if (!party) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${id}`);
  }

  const { period } = req.query;

  if (period === 'custom') {
    const from = parseMonthParam(req.query.from);
    const to = parseMonthParam(req.query.to);
    if (!from || !to) {
      return sendError(res, 400, 'VALIDATION_ERROR', "from and to must be YYYY-MM for a custom range");
    }
    if (to.year < from.year || (to.year === from.year && to.month < from.month)) {
      return sendError(res, 400, 'VALIDATION_ERROR', "'to' must not be before 'from'");
    }
    const result = await revenueForPeriod(prisma, 'custom', {
      partyId: id,
      custom: { fromYear: from.year, fromMonth: from.month, toYear: to.year, toMonth: to.month },
    });
    return res.json({ revenue: result.revenue, period: result.period, label: result.label });
  }

  if (!VALID_PERIODS.includes(period) || period === 'custom') {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      `period must be one of ${VALID_PERIODS.filter((p) => p !== 'custom').join(', ')}, or 'custom' with from/to`
    );
  }

  const result = await revenueForPeriod(prisma, period, { partyId: id });
  res.json({ revenue: result.revenue, period: result.period, label: result.label });
}

// GET /api/parties/:id/payable — OWNER only (👑), PIN NOT required (matching
// GET /api/factories/:id/payable's own gating — reading a figure isn't itself a financial
// action; PIN is reserved for POST/PATCH/DELETE below, the actual writes). Party Payables, the
// mirror of Factory Payables in the reverse direction (added 2026-08-21).
//
// Amount Due = totalBilled − totalPaid − totalReturned:
//   - totalBilled reuses utils/revenue.js's computeRevenue(prisma, { partyId, from: null, to:
//     null }) DIRECTLY — not reimplemented. That call already computes exactly "SUM over
//     non-cancelled BILLED+SHIPPED orders/lines for this party, all-time, per-piece basis"
//     (rule 98), which is exactly what "totalBilled" means here.
//   - totalPaid is SUM(PartyPayment.amount) for this party.
//   - totalReturned is SUM(qtySets × piecesPerSet × priceAtReturn) over this party's
//     PartyStockReturn rows — rule 86's corrected, per-piece formula. This is that formula's
//     first real caller anywhere in the codebase; verified against real hand-computed numbers
//     when this endpoint was built, not just smoke-tested (see LEARNING_LOG.md).
//
// Computed fresh from live rows on every call, no caching — same principle as every other money
// figure in this system (rules 60, 81, 96, 98).
async function getPartyPayable(req, res) {
  const { id } = req.params;

  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${id}`);
  }

  const [totalBilled, payments, returns] = await Promise.all([
    computeRevenue(prisma, { partyId: id, from: null, to: null }),
    prisma.partyPayment.findMany({
      where: { partyId: id },
      select: { id: true, amount: true, date: true, note: true, createdAt: true, updatedAt: true, wasEdited: true },
      // Two-level sort, same reasoning as the factory payable: `date` is the real-world order a
      // backdated entry belongs in, `createdAt` (never user-edited) tiebreaks entries sharing a
      // date by which was actually recorded first.
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.partyStockReturn.findMany({
      where: { partyId: id },
      select: {
        qtySets: true,
        priceAtReturn: true,
        bundle: { select: { product: { select: { isKids: true, sizes: { select: { sizeLabel: true, qty: true } } } } } },
      },
    }),
  ]);

  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalReturned = returns.reduce(
    (sum, r) => sum + r.qtySets * piecesPerSetFor(r.bundle.product) * Number(r.priceAtReturn),
    0
  );

  res.json({
    partyId: id,
    totalBilled,
    totalPaid,
    totalReturned,
    amountDue: totalBilled - totalPaid - totalReturned,
    payments,
  });
}

module.exports = {
  listParties,
  createParty,
  updateParty,
  deactivateParty,
  reactivateParty,
  getPartyRevenue,
  getPartyPayable,
};
