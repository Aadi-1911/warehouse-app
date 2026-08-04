const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true };

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

module.exports = { listColors, createColor };
