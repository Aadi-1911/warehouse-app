const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true, isActive: true };

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

module.exports = { listLocations, createLocation, deactivateLocation, reactivateLocation };
