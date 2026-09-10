const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const DEBIT_SELECT = {
  id: true,
  partyId: true,
  amount: true,
  date: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  wasEdited: true,
};

// POST /api/party-debits — OWNER only (👑) AND PIN-gated (📌, via requirePin in
// routes/partyDebits.js) — identical gating to POST /api/factory-debits, since this is the same
// kind of action in the reverse direction: a manual increase to what a Party owes, for real
// pre-app debt (e.g. an opening balance from the paper ledger) that has no Order behind it
// (05_BUSINESS_RULES.md rule 106). req.body.pin is read by the requirePin middleware before this
// handler ever runs — nothing here needs to check it directly.
async function createPartyDebit(req, res) {
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

  const debit = await prisma.partyDebit.create({
    data: {
      partyId,
      amount,
      date: parsedDate,
      note: note || null,
      createdById: req.user.id,
    },
    select: DEBIT_SELECT,
  });

  res.status(201).json(debit);
}

module.exports = { createPartyDebit };
