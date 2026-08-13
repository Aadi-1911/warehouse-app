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
    select: { id: true, factoryId: true, amount: true, date: true, note: true, createdAt: true, updatedAt: true, wasEdited: true },
  });

  res.status(201).json(payment);
}

const PATCHABLE_FIELDS = ['amount', 'date', 'note'];

// PATCH /api/factory-payments/:id — OWNER only (👑) AND PIN-gated (📌, via requirePin in
// routes/factoryPayments.js), unconditionally — unlike Product's PATCH (where the PIN is only
// required when a price field is touched), every field on this resource (amount/date/note) IS
// a financial detail, so there's no non-sensitive subset that could skip the PIN. Accepts any
// subset of the editable fields, matching the established PATCH convention (updateFactory,
// updateProduct) rather than requiring all three every time. Correcting a mistaken amount/date/
// note is the entire reason this exists — marks wasEdited: true so the correction is never
// silently invisible, but stays a real edit, not a formal audit trail with before/after values
// kept (see LEARNING_LOG.md).
async function updateFactoryPayment(req, res) {
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

  const existing = await prisma.factoryPayment.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'FACTORY_PAYMENT_NOT_FOUND', `No factory payment with id ${id}`);
  }

  // Explicit, not inferred — set unconditionally whenever a real edit is being saved (the
  // Object.keys(data).length === 0 guard above already ruled out a no-op PATCH reaching here).
  // Never set back to false: once corrected, always shows as corrected. Replaces an earlier
  // updatedAt-vs-createdAt-plus-60-seconds heuristic that missed an edit made within a minute
  // of creation — see LEARNING_LOG.md.
  data.wasEdited = true;

  const updated = await prisma.factoryPayment.update({
    where: { id },
    data,
    select: { id: true, factoryId: true, amount: true, date: true, note: true, createdAt: true, updatedAt: true, wasEdited: true },
  });

  res.json(updated);
}

// DELETE /api/factory-payments/:id — OWNER only (👑) AND PIN-gated (📌), unconditionally, same
// reasoning as PATCH above. A genuine hard delete, not the soft-deactivate/isActive pattern
// used everywhere else in this schema (Factory/Product/User/Location/Party/Category) — those
// all need the soft form because other rows reference them by foreign key and must stay
// resolvable forever (Bundle/Transaction/Stock history tracing back through factoryId,
// productId, etc.). Nothing in this schema references FactoryPayment by foreign key, so there's
// no orphaning risk a hard delete could create, and no "hidden from pickers, still accessible"
// state that would even mean anything for a single logged financial entry.
async function deleteFactoryPayment(req, res) {
  const { id } = req.params;

  const existing = await prisma.factoryPayment.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'FACTORY_PAYMENT_NOT_FOUND', `No factory payment with id ${id}`);
  }

  await prisma.factoryPayment.delete({ where: { id } });
  res.status(204).send();
}

module.exports = { createFactoryPayment, updateFactoryPayment, deleteFactoryPayment };
