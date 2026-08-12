const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true };

// GET /api/categories — any authenticated role (🔒)
async function listCategories(req, res) {
  const categories = await prisma.category.findMany({ select: SELECT });
  res.json(categories);
}

// POST /api/categories — any authenticated role (🔒). Mirrors createColor exactly: 04_API_SPEC.md
// recommends case-insensitive uniqueness ("Hoodie" vs "hoodie") — the schema's `name @unique` is
// a plain Postgres unique index, case-SENSITIVE by default, so it alone would let both through.
// A case-insensitive pre-check catches that; catching P2002 on the create is a backup for the
// exact-case race the pre-check alone can't fully close.
async function createCategory(req, res) {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  }
  const trimmed = name.trim();

  const existing = await prisma.category.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) {
    return sendError(res, 409, 'DUPLICATE_CATEGORY', `Category "${existing.name}" already exists`);
  }

  try {
    const category = await prisma.category.create({ data: { name: trimmed }, select: SELECT });
    res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_CATEGORY', `Category "${trimmed}" already exists`);
    }
    throw err;
  }
}

module.exports = { listCategories, createCategory };
