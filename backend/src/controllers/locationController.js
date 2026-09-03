const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
const { locationRevenueForPeriod } = require('../utils/locationRevenue');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true, isActive: true, profitSharePercent: true };

// GET /api/locations — any authenticated role (🔒)
async function listLocations(req, res) {
  const locations = await prisma.location.findMany({ select: SELECT });
  res.json(locations);
}

// POST /api/locations — OWNER only (👑) per 04_API_SPEC.md, unlike Factories/Colors.
// Applying the same case-insensitive uniqueness pattern as Color, by analogy — the spec only
// states it explicitly for Colors, but Location names are the same class of short free-text
// field prone to the same "Delhi" vs "delhi" duplication problem.
async function createLocation(req, res) {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  }
  const trimmed = name.trim();

  const existing = await prisma.location.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) {
    return sendError(res, 409, 'DUPLICATE_LOCATION', `Location "${existing.name}" already exists`);
  }

  try {
    const location = await prisma.location.create({ data: { name: trimmed }, select: SELECT });
    res.status(201).json(location);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_LOCATION', `Location "${trimmed}" already exists`);
    }
    throw err;
  }
}

// PATCH /api/locations/:id/deactivate — OWNER only (👑), matching createLocation's own gating
// (unlike Factory/Color/Product, Location creation is already OWNER-restricted, so deactivate
// stays consistent with that rather than opening up to any role). Soft-deactivate only, NEVER
// hard-delete — Stock/Transaction rows reference locationId and must stay resolvable forever,
// same principle as User.isActive. Idempotent: deactivating an already-inactive location just
// re-confirms the state, not an error. No lockout-prevention guard (unlike userController's
// deactivateUser) — that pair exists specifically because the system must never reach zero
// active OWNER accounts; a Location has no equivalent structural risk.
async function deactivateLocation(req, res) {
  const { id } = req.params;

  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${id}`);
  }

  const location = await prisma.location.update({ where: { id }, data: { isActive: false }, select: SELECT });
  res.json(location);
}

// PATCH /api/locations/:id/reactivate — OWNER only (👑). Reverses a deactivation.
async function reactivateLocation(req, res) {
  const { id } = req.params;

  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${id}`);
  }

  const location = await prisma.location.update({ where: { id }, data: { isActive: true }, select: SELECT });
  res.json(location);
}

// PATCH /api/locations/:id/profit-share — OWNER only (👑), matching create/deactivate's own
// gating. Deliberately NO PIN — confirmed against the task's own instruction: this isn't a
// costPrice/sellingPrice edit (the non-negotiable PIN rule is specific to those two fields), it's
// an admin setting on Location, same class of action as deactivate/reactivate above.
// Body: { profitSharePercent }, an integer 0-100.
async function updateProfitShare(req, res) {
  const { id } = req.params;
  const { profitSharePercent } = req.body;

  if (!Number.isInteger(profitSharePercent) || profitSharePercent < 0 || profitSharePercent > 100) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'profitSharePercent must be an integer between 0 and 100');
  }

  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${id}`);
  }

  const location = await prisma.location.update({ where: { id }, data: { profitSharePercent }, select: SELECT });
  res.json(location);
}

// GET /api/locations/revenue?period=month|six_months|fy|all — OWNER only (👑). Thin wrapper
// around utils/locationRevenue.js's locationRevenueForPeriod — no revenue/profit math lives
// here, same "endpoint just supplies a period name" shape as GET /api/parties/:id/revenue.
// Deliberately no 'custom' From/To range (unlike the Parties page) — the Owner Dashboard's
// Locations page (§8 extension, added 2026-08-20) only offers the four period chips.
//
// Returns EVERY location's figures in one call, not scoped to one id — locationRevenueForPeriod
// already computes all locations in a single pass (one Stock query, one Transaction query), so
// splitting this into a per-location endpoint would either waste that batching or force the
// frontend to refetch on every toggle. One call per period change; toggling location client-side
// is instant.
//
// OWNER only, non-negotiably — `profit` is derived from `costPrice`, which CLAUDE.md's first rule
// says must never reach a STAFF request "under any circumstance," same reasoning as the Overview
// KPI's own stockValue gating.
const LOCATION_REVENUE_PERIODS = ['month', 'six_months', 'fy', 'all'];

async function getLocationsRevenue(req, res) {
  const { period } = req.query;
  if (!LOCATION_REVENUE_PERIODS.includes(period)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `period must be one of ${LOCATION_REVENUE_PERIODS.join(', ')}`);
  }
  const result = await locationRevenueForPeriod(prisma, period);
  res.json(result);
}

module.exports = {
  listLocations,
  createLocation,
  deactivateLocation,
  reactivateLocation,
  updateProfitShare,
  getLocationsRevenue,
};
