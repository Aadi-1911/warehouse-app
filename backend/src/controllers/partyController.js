const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// Every scalar field on Party (03_DATABASE_SCHEMA.md's minimal Phase 1 form) except createdAt —
// matches the shape Factory/Color/Location's own SELECTs use (public fields + isActive), same
// convention even though Party has no create/list endpoint yet to establish one independently.
const SELECT = {
  id: true,
  name: true,
  shopName: true,
  location: true,
  address: true,
  contact: true,
  gstNo: true,
  isActive: true,
};

// PATCH /api/parties/:id/deactivate — OWNER only (👑). Party has no POST/GET endpoint yet
// (out of scope for this task — only deactivate/reactivate were asked for), so there's no
// existing creation gate to mirror the way Factory/Product/Color/Location's deactivate
// endpoints do; OWNER-only was chosen deliberately for a customer/shop-relationship record,
// treating it like Location rather than the more casual Color/Factory lookup lists. Soft-
// deactivate only, NEVER hard-delete — Transaction/PartyStockReturn rows reference partyId and
// must stay resolvable forever, same principle as User.isActive. Idempotent: deactivating an
// already-inactive party just re-confirms the state, not an error. No lockout-prevention guard
// (unlike userController's deactivateUser) — that pair exists specifically because the system
// must never reach zero active OWNER accounts; a Party has no equivalent structural risk.
async function deactivateParty(req, res) {
  const { id } = req.params;

  const existing = await prisma.party.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${id}`);
  }

  const party = await prisma.party.update({ where: { id }, data: { isActive: false }, select: SELECT });
  res.json(party);
}

// PATCH /api/parties/:id/reactivate — OWNER only (👑). Reverses a deactivation.
async function reactivateParty(req, res) {
  const { id } = req.params;

  const existing = await prisma.party.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${id}`);
  }

  const party = await prisma.party.update({ where: { id }, data: { isActive: true }, select: SELECT });
  res.json(party);
}

module.exports = { deactivateParty, reactivateParty };
