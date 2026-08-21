const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// POST /api/party-payments — OWNER only (👑) AND PIN-gated (📌, via requirePin in
// routes/partyPayments.js). Records money paid BY a Party to the business, reducing amountDue —
// mirrors FactoryPayment for the reverse direction. Same reasoning for the PIN as Factory
// Payments: a real financial action, not a decorative role-only gate.
async function createPartyPayment(req, res) {
  const { partyId, amount, date, note } = req.body;

  if (!partyId || amount == null || !date) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'partyId, amount, and date are required');
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'amount must be a positive number');
  }
  const parsedDate = new Date(date);
  if (isNaN(parsedDate)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'date must be a valid date');
  }

  const party = await prisma.party.findUnique({ where: { id: partyId } });
  if (!party) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${partyId}`);
  }

  const payment = await prisma.partyPayment.create({
    data: { partyId, amount, date: parsedDate, note: note || null, createdById: req.user.id },
    select: { id: true, partyId: true, amount: true, date: true, note: true, createdAt: true, updatedAt: true, wasEdited: true },
  });

  res.status(201).json(payment);
}

// PATCH /api/party-payments/:id — OWNER only (👑) AND PIN-gated (📌), unconditionally — every
// field here (amount/date/note) is a financial detail, same reasoning as
// PATCH /api/factory-payments/:id. Accepts any subset of the editable fields. Sets
// wasEdited: true unconditionally, never reset back to false.
async function updatePartyPayment(req, res) {
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

  const existing = await prisma.partyPayment.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PARTY_PAYMENT_NOT_FOUND', `No party payment with id ${id}`);
  }

  data.wasEdited = true;

  const updated = await prisma.partyPayment.update({
    where: { id },
    data,
    select: { id: true, partyId: true, amount: true, date: true, note: true, createdAt: true, updatedAt: true, wasEdited: true },
  });

  res.json(updated);
}

// DELETE /api/party-payments/:id — OWNER only (👑) AND PIN-gated (📌), unconditionally, same
// reasoning as PATCH above. A genuine hard delete, same safety argument as
// DELETE /api/factory-payments/:id: confirmed nothing else in the schema references
// PartyPayment by foreign key (grepped schema.prisma — only Party.payments PartyPayment[], the
// back-relation of PartyPayment.partyId itself, points at this model at all), so there is no
// orphaning risk a hard delete could create here.
async function deletePartyPayment(req, res) {
  const { id } = req.params;

  const existing = await prisma.partyPayment.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PARTY_PAYMENT_NOT_FOUND', `No party payment with id ${id}`);
  }

  await prisma.partyPayment.delete({ where: { id } });
  res.status(204).send();
}

module.exports = { createPartyPayment, updatePartyPayment, deletePartyPayment };
