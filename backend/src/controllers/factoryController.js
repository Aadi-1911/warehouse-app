const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true, contact: true };

// GET /api/factories — any authenticated role (🔒)
async function listFactories(req, res) {
  const factories = await prisma.factory.findMany({ select: SELECT });
  res.json(factories);
}

// POST /api/factories — any authenticated role (🔒) — Factories grow via normal usage,
// no OWNER gate. No uniqueness rule for Factory name either in the spec or the schema
// (unlike Color/Location) — two factories legitimately could share a display name.
async function createFactory(req, res) {
  const { name, contact } = req.body;
  if (!name || !name.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  }

  const factory = await prisma.factory.create({
    data: { name: name.trim(), contact: contact || null },
    select: SELECT,
  });
  res.status(201).json(factory);
}

module.exports = { listFactories, createFactory };
