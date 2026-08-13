const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// POST /api/factory-debits — OWNER only (👑) AND PIN-gated (📌, via requirePin in
// routes/factoryDebits.js) — same gating as POST /api/factory-payments, since this is an
// equally sensitive financial action in the reverse direction: it increases what the business
// owes a factory rather than recording a reduction. Records a manual increase to amountPayable
// — the mirror of FactoryPayment, for real pre-app debt that was never logged as STOCK_IN
// transaction history (05_BUSINESS_RULES.md rule 96). req.body.pin is read by the requirePin
// middleware before this handler ever runs — nothing here needs to check it directly.
async function createFactoryDebit(req, res) {
  const { factoryId, amount, date, note } = req.body;

  if (!factoryId || amount == null || !date) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'factoryId, amount, and date are required');
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'amount must be a positive number');
  }
  const parsedDate = new Date(date);
  if (isNaN(parsedDate)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'date must be a valid date');
  }

  const factory = await prisma.factory.findUnique({ where: { id: factoryId } });
  if (!factory) {
    return sendError(res, 404, 'FACTORY_NOT_FOUND', `No factory with id ${factoryId}`);
  }

  const debit = await prisma.factoryDebit.create({
    data: { factoryId, amount, date: parsedDate, note: note || null, createdById: req.user.id },
    select: { id: true, factoryId: true, amount: true, date: true, note: true, createdAt: true, updatedAt: true, wasEdited: true },
  });

  res.status(201).json(debit);
}

// PATCH /api/factory-debits/:id — mirrors updateFactoryPayment exactly (same fields, same
// unconditional OWNER+PIN gate, same reasoning) for the reverse-direction entity. See
// factoryPaymentController.js's PATCH for the full comment — not repeated here beyond this
// pointer, per the same "don't let identical logic drift across two places" reasoning already
// applied to the create handlers.
async function updateFactoryDebit(req, res) {
  const { id } = req.params;
  const body = req.body;

  const data = {};
  if ('amount' in body) {
    if (typeof body.amount !== 'number' || body.amount <= 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'amount must be a positive number');
    }
    data.amount = body.amount;
  }
  if ('date' in body) {
    const parsedDate = new Date(body.date);
    if (isNaN(parsedDate)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'date must be a valid date');
    }
    data.date = parsedDate;
  }
  if ('note' in body) {
    data.note = body.note || null;
  }

  if (Object.keys(data).length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'No editable fields provided');
  }

  const existing = await prisma.factoryDebit.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'FACTORY_DEBIT_NOT_FOUND', `No factory debit with id ${id}`);
  }

  // See updateFactoryPayment's PATCH for the full reasoning — mirrored exactly here.
  data.wasEdited = true;

  const updated = await prisma.factoryDebit.update({
    where: { id },
    data,
    select: { id: true, factoryId: true, amount: true, date: true, note: true, createdAt: true, updatedAt: true, wasEdited: true },
  });

  res.json(updated);
}

// DELETE /api/factory-debits/:id — mirrors deleteFactoryPayment exactly. A genuine hard delete
// — nothing in this schema references FactoryDebit by foreign key, so no orphaning risk and no
// soft-delete pattern needed, same reasoning as the payment side.
async function deleteFactoryDebit(req, res) {
  const { id } = req.params;

  const existing = await prisma.factoryDebit.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'FACTORY_DEBIT_NOT_FOUND', `No factory debit with id ${id}`);
  }

  await prisma.factoryDebit.delete({ where: { id } });
  res.status(204).send();
}

module.exports = { createFactoryDebit, updateFactoryDebit, deleteFactoryDebit };
