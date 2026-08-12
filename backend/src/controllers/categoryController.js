const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// isActive added here so deactivate/reactivate below have something to report — matches
// Color/Factory/Location/Party's own SELECT shape (public fields + isActive), same convention.
const SELECT = { id: true, name: true, isActive: true };

// GET /api/categories — any authenticated role (🔒). No isActive filtering — same convention
// as every other archived entity: the response always includes isActive, and hiding archived
// records from daily pickers is a frontend concern (rule 85), not a server-side one.
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

// PATCH /api/categories/:id/deactivate — any authenticated role (🔒), matching createCategory's
// own gating. Soft-deactivate only, NEVER hard-delete — Product rows reference categoryId and
// must stay resolvable forever, same principle as User.isActive. Idempotent: deactivating an
// already-inactive category just re-confirms the state, not an error. No lockout-prevention
// guard (unlike userController's deactivateUser) — that pair exists specifically because the
// system must never reach zero active OWNER accounts; a Category has no equivalent structural
// risk. Closes rule 85's remaining gap — the last of the six archivable entities to get this.
async function deactivateCategory(req, res) {
  const { id } = req.params;

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'CATEGORY_NOT_FOUND', `No category with id ${id}`);
  }

  const category = await prisma.category.update({ where: { id }, data: { isActive: false }, select: SELECT });
  res.json(category);
}

// PATCH /api/categories/:id/reactivate — any authenticated role (🔒). Reverses a deactivation.
async function reactivateCategory(req, res) {
  const { id } = req.params;

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'CATEGORY_NOT_FOUND', `No category with id ${id}`);
  }

  const category = await prisma.category.update({ where: { id }, data: { isActive: true }, select: SELECT });
  res.json(category);
}

module.exports = { listCategories, createCategory, deactivateCategory, reactivateCategory };
