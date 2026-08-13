const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// POST /api/factory-payments — OWNER only (👑) AND PIN-gated (📌, via requirePin in
// routes/factoryPayments.js). Records money paid TO a Factory, reducing amountPayable —
// mirrors the party-facing Payment entity for the reverse direction. Originally shipped
// role-only, no PIN (real money movement, but not itself a cost/selling-price read or write);
// revisited when the Factory Payables screen needed a real PIN gate on recording a payment
// rather than a decorative one, and role-only was judged too weak for a live financial action
// once the screen made that gap concrete. req.body.pin is read by the requirePin middleware
// before this handler ever runs — nothing here needs to check it directly.
async function createFactoryPayment(req, res) {
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

  const payment = await prisma.factoryPayment.create({
    data: { factoryId, amount, date: parsedDate, note: note || null, createdById: req.user.id },
    select: { id: true, factoryId: true, amount: true, date: true, note: true, createdAt: true },
  });

  res.status(201).json(payment);
}

module.exports = { createFactoryPayment };
