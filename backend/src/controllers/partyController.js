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

// GET /api/parties — any authenticated role (🔒), matching Location/Factory/Color's own GET
// gating. No isActive filtering here — same convention as every other archived entity: the
// response always includes isActive, and hiding archived records from daily pickers is a
// frontend concern, not a server-side one. This keeps "hidden from pickers" and "fully
// accessible when needed" (rule 85) both true from one unfiltered endpoint.
async function listParties(req, res) {
  const parties = await prisma.party.findMany({ select: SELECT });
  res.json(parties);
}

// POST /api/parties — OWNER only (👑), per an explicit decision made when this task was scoped:
// unlike Factory/Color/Category (open to any role), Party is treated like Location — a
// customer/shop-relationship record, not a casual lookup list. Case-insensitive uniqueness on
// name mirrors Color/Category/Location's own pattern (pre-check + P2002 catch as backup for the
// exact-case race the pre-check alone can't fully close).
//
// One real gap, worth flagging rather than quietly matching in name only: Color.name and the
// newer Factory.name both carry a DB-level `@unique` index, so their P2002 catch is a genuine
// backstop. Party.name has NO such index in schema.prisma — nothing currently in this codebase
// enforces it below the application layer. The P2002 catch below is kept anyway (harmless, and
// it starts doing real work the moment a unique index is added), but as of this task the
// pre-check is the only defense that actually exists; two POSTs for the same name landing in
// the same race window could both succeed. Not fixed here — adding a DB constraint is a schema
// migration, outside this task's scope of "build the endpoints."
async function createParty(req, res) {
  const { name, shopName, location, address, contact, gstNo } = req.body;
  if (!name || !name.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  }
  const trimmed = name.trim();

  const existing = await prisma.party.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) {
    return sendError(res, 409, 'DUPLICATE_PARTY', `Party "${existing.name}" already exists`);
  }

  try {
    const party = await prisma.party.create({
      data: {
        name: trimmed,
        shopName: shopName?.trim() || null,
        location: location?.trim() || null,
        address: address?.trim() || null,
        contact: contact?.trim() || null,
        gstNo: gstNo?.trim() || null,
      },
      select: SELECT,
    });
    res.status(201).json(party);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_PARTY', `Party "${trimmed}" already exists`);
    }
    throw err;
  }
}

// PATCH /api/parties/:id/deactivate — OWNER only (👑), matching createParty's own gating.
// Soft-deactivate only, NEVER hard-delete — Transaction/PartyStockReturn rows reference partyId
// and must stay resolvable forever, same principle as User.isActive. Idempotent: deactivating an
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

module.exports = { listParties, createParty, deactivateParty, reactivateParty };
