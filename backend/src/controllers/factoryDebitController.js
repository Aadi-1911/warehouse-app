const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
const { normalizeBillNo } = require('../utils/billNo');

const prisma = new PrismaClient();

// Every handler below returns the same shape — billNo rides along with the rest so the frontend
// can render it straight from a create/update response without a re-fetch. Not role-gated here
// the way Order.billNo is: every factory-debit endpoint is already OWNER+PIN at the route, so
// there is no STAFF request that can reach this select at all.
const DEBIT_SELECT = {
  id: true,
  factoryId: true,
  amount: true,
  date: true,
  note: true,
  billNo: true,
  createdAt: true,
  updatedAt: true,
  wasEdited: true,
};

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
  // Optional throughout — a debit with no bill number is completely normal (rule 96's whole
  // reason for existing is pre-app debt with no paperwork logged in this system).
  const billNo = normalizeBillNo(req.body.billNo);
  if (!billNo.ok) {
    return sendError(res, 400, 'VALIDATION_ERROR', billNo.message);
  }

  const factory = await prisma.factory.findUnique({ where: { id: factoryId } });
  if (!factory) {
    return sendError(res, 404, 'FACTORY_NOT_FOUND', `No factory with id ${factoryId}`);
  }

  const debit = await prisma.factoryDebit.create({
    data: {
      factoryId,
      amount,
      date: parsedDate,
      note: note || null,
      billNo: billNo.provided ? billNo.value : null,
      createdById: req.user.id,
    },
    select: DEBIT_SELECT,
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

  // billNo is deliberately NOT editable through this handler — see updateFactoryDebitBillNo
  // below for where it's edited and why it needs its own endpoint.

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
    select: DEBIT_SELECT,
  });

  res.json(updated);
}

// PATCH /api/factory-debits/:id/bill-no — OWNER only (👑), NO PIN. Corrects (or clears) the
// reference tag on an existing debit, nothing else. Added 2026-08-30.
//
// Its own endpoint rather than another field on the PATCH above, for two reasons that both point
// the same way:
//
//   1. PIN. The main PATCH is unconditionally PIN-gated because every field it touches is
//      financial (rules 81/96). A bill number is not — it moves no money, and this handler
//      provably cannot change an amount, since `data` below has exactly one key. Routing a typo
//      fix through a PIN prompt would be a decorative gate, which is precisely what this project
//      already rejected once for the opposite reason (see factoryPaymentController's own history).
//
//   2. wasEdited. That flag means "the money on this entry was corrected" — it's what makes the
//      history row render an "edited" label warning an owner that a figure isn't the original.
//      Fixing a mistyped reference tag says nothing about whether the amount can be trusted, so
//      setting it here would dilute a specific, useful signal into a vague "someone touched this
//      row." This handler never writes wasEdited at all, which makes that guarantee structural
//      rather than a conditional someone could later get wrong.
async function updateFactoryDebitBillNo(req, res) {
  const { id } = req.params;

  const billNo = normalizeBillNo(req.body?.billNo);
  if (!billNo.ok) {
    return sendError(res, 400, 'VALIDATION_ERROR', billNo.message);
  }
  if (!billNo.provided) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'billNo is required');
  }

  const existing = await prisma.factoryDebit.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return sendError(res, 404, 'FACTORY_DEBIT_NOT_FOUND', `No factory debit with id ${id}`);
  }

  const updated = await prisma.factoryDebit.update({
    where: { id },
    data: { billNo: billNo.value },
    select: DEBIT_SELECT,
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

module.exports = { createFactoryDebit, updateFactoryDebit, updateFactoryDebitBillNo, deleteFactoryDebit };
