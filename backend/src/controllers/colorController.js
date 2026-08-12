const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true, isActive: true };

// GET /api/colors — any authenticated role (🔒)
async function listColors(req, res) {
  const colors = await prisma.color.findMany({ select: SELECT });
  res.json(colors);
}

// POST /api/colors — any authenticated role (🔒). 04_API_SPEC.md explicitly recommends
// case-insensitive uniqueness ("Navy" vs "navy") — the schema's `name @unique` is a plain
// Postgres unique index, which is case-SENSITIVE by default, so it alone would let both
// through. A case-insensitive pre-check catches that; catching P2002 on the create is a
// backup for the exact-case race the pre-check alone can't fully close.
async function createColor(req, res) {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  }
  const trimmed = name.trim();

  const existing = await prisma.color.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) {
    return sendError(res, 409, 'DUPLICATE_COLOR', `Color "${existing.name}" already exists`);
  }

  try {
    const color = await prisma.color.create({ data: { name: trimmed }, select: SELECT });
    res.status(201).json(color);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_COLOR', `Color "${trimmed}" already exists`);
    }
    throw err;
  }
}

// PATCH /api/colors/:id/deactivate — any authenticated role (🔒), matching createColor's own
// gating. Soft-deactivate only, NEVER hard-delete — Bundle rows reference colorId and must stay
// resolvable forever, same principle as User.isActive. Idempotent: deactivating an
// already-inactive color just re-confirms the state, not an error. No lockout-prevention guard
// (unlike userController's deactivateUser) — that pair exists specifically because the system
// must never reach zero active OWNER accounts; a Color has no equivalent structural risk.
async function deactivateColor(req, res) {
  const { id } = req.params;

  const existing = await prisma.color.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'COLOR_NOT_FOUND', `No color with id ${id}`);
  }

  const color = await prisma.color.update({ where: { id }, data: { isActive: false }, select: SELECT });
  res.json(color);
}

// PATCH /api/colors/:id/reactivate — any authenticated role (🔒). Reverses a deactivation.
async function reactivateColor(req, res) {
  const { id } = req.params;

  const existing = await prisma.color.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'COLOR_NOT_FOUND', `No color with id ${id}`);
  }

  const color = await prisma.color.update({ where: { id }, data: { isActive: true }, select: SELECT });
  res.json(color);
}

module.exports = { listColors, createColor, deactivateColor, reactivateColor };
