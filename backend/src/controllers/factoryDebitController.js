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
    select: { id: true, factoryId: true, amount: true, date: true, note: true, createdAt: true },
  });

  res.status(201).json(debit);
}

module.exports = { createFactoryDebit };
