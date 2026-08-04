const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true };

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

module.exports = { listLocations, createLocation };
