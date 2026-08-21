const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
const { verifyPin } = require('../middleware/requirePin');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true, username: true, role: true, isActive: true, isPrimaryOwner: true };
const VALID_ROLES = ['OWNER', 'STAFF'];
const SALT_ROUNDS = 10; // matches seed.js — same hashing strength for every password in this app
const PIN_SALT_ROUNDS = 10; // matches seed.js's PIN hash and every other PIN hash in this app

// GET /api/users — OWNER only (👑). passwordHash/priceEditPinHash are never SELECTed — same
// pattern as costPrice's OWNER-only visibility in productController.js: the fields don't exist
// on the fetched object at all, not "fetched then stripped before responding."
async function listUsers(req, res) {
  const users = await prisma.user.findMany({ select: SELECT });
  res.json(users);
}

// POST /api/users — OWNER only (👑). Creating a STAFF or non-primary OWNER account is open to
// any OWNER; creating an OWNER account specifically requires isPrimaryOwner (rule 74) — checked
// against req.user.isPrimaryOwner, which auth.js re-derives fresh from the DB on this same
// request, never trusted from the JWT. New accounts always start with priceEditPinHash: null
// and isPrimaryOwner: false — neither is ever set here, both are left to the schema's defaults,
// since a PIN is exclusively self-service (rule 73) and primary-owner status is exclusively
// the one originally-seeded account (seed.js), never something granted via this endpoint.
async function createUser(req, res) {
  const { name, username, password, role } = req.body;

  if (!name || !username || !password || !role) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name, username, password, and role are required');
  }
  if (!VALID_ROLES.includes(role)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `role must be one of: ${VALID_ROLES.join(', ')}`);
  }
  if (role === 'OWNER' && !req.user.isPrimaryOwner) {
    return sendError(res, 403, 'FORBIDDEN_ROLE', 'Only the primary owner can create additional OWNER accounts');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const user = await prisma.user.create({
      data: { name, username, passwordHash, role },
      select: SELECT,
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_USERNAME', `Username "${username}" already exists`);
    }
    throw err;
  }
}

// PATCH /api/users/:id/deactivate — OWNER only (👑), no PIN. Soft-deactivate only — never
// hard-delete (rule 75) — Transaction rows reference userId and must stay resolvable forever.
// Idempotent: deactivating an already-inactive user just re-confirms the state, not an error.
//
// Two guards close a real total-lockout risk (04_API_SPEC.md): self-deactivation is always
// rejected, and the last active OWNER can never be deactivated through this endpoint. Checked
// in this order deliberately — under this route's own auth model (OWNER-only, and requireAuth
// already rejects inactive users), whoever is making this request IS necessarily a currently
// active OWNER. So if the target is the sole remaining active owner, the requester — who must
// also be an active owner to have reached this route at all — is necessarily that same
// person: the self-check alone already covers every single-request "sole owner" scenario, and
// is checked first for exactly that reason. The last-owner count check still runs
// independently afterward, both because the literal spec asks for it as its own guard and
// because it's the one that would matter if two different owners raced to deactivate two
// different owners at the same instant — a real gap this simple count check does not close
// (that would need row-level locking, not attempted here given how rare and low-stakes that
// race is for a low-frequency, owner-only admin action).
async function deactivateUser(req, res) {
  const { id } = req.params;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'USER_NOT_FOUND', `No user with id ${id}`);
  }

  if (id === req.user.id) {
    return sendError(res, 403, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
  }

  if (existing.role === 'OWNER' && existing.isActive) {
    const activeOwnerCount = await prisma.user.count({ where: { role: 'OWNER', isActive: true } });
    if (activeOwnerCount <= 1) {
      return sendError(
        res,
        403,
        'LAST_ACTIVE_OWNER',
        'Cannot deactivate the last remaining active OWNER account'
      );
    }
  }

  const user = await prisma.user.update({ where: { id }, data: { isActive: false }, select: SELECT });
  res.json(user);
}

// PATCH /api/users/:id/reactivate — OWNER only (👑), no PIN. Reverses a deactivation.
async function reactivateUser(req, res) {
  const { id } = req.params;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'USER_NOT_FOUND', `No user with id ${id}`);
  }

  const user = await prisma.user.update({ where: { id }, data: { isActive: true }, select: SELECT });
  res.json(user);
}

// PATCH /api/users/me/pin — OWNER only (route-gated). The ONLY way a PIN is ever set (rule 73)
// — never by whoever created the account. First-time setup (priceEditPinHash currently null)
// needs no currentPin, since there's no existing PIN to prove knowledge of. Once a PIN exists,
// changing it reuses verifyPin — the exact same lockout counters as the price-edit PIN gate,
// since it's the same secret and the same brute-force risk (see requirePin.js).
async function updateOwnPin(req, res) {
  const { newPin, currentPin } = req.body;

  if (!newPin) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'newPin is required');
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    return sendError(res, 401, 'USER_NOT_FOUND', 'User no longer exists');
  }

  if (user.priceEditPinHash) {
    const result = await verifyPin(req.user.id, currentPin);
    if (!result.ok) {
      return sendError(res, result.status, result.code, result.message, result.extra || {});
    }
  }

  const priceEditPinHash = await bcrypt.hash(newPin, PIN_SALT_ROUNDS);
  await prisma.user.update({
    where: { id: req.user.id },
    data: { priceEditPinHash, failedPinAttempts: 0, pinLockedUntil: null },
  });

  res.json({ message: 'PIN updated successfully' });
}

// POST /api/users/me/verify-pin — OWNER only (👑) AND PIN-gated (📌, via requirePin in
// routes/users.js). Added 2026-08-21 for the Owner Dashboard's PIN lock screen.
//
// The one PIN endpoint with NO side effects of its own — every other PIN use in this app
// (price edits, factory payments/debits, password resets) verifies the PIN as a precondition of
// a real write. The dashboard lock has nothing to write: the question genuinely is just "is this
// the owner's PIN," so it gets its own endpoint rather than a mutating one being repurposed with
// a no-op payload, which would make the audit story ("what was this request FOR?") a lie.
//
// requirePin does all the actual work — same hash comparison, same failedPinAttempts counter,
// same 5-attempt/15-minute lockout, same INVALID_PIN/PIN_LOCKED/PIN_NOT_SET codes as everywhere
// else. Reaching this handler at all means the PIN was correct, so it only reports success.
//
// NOT a security boundary, and deliberately not treated as one: the dashboard is already fully
// protected by requireRole('OWNER') on every underlying route (a STAFF token can't read those
// endpoints whatever the frontend renders). This is a privacy gate so the owner can blank his own
// screen from a bystander — the lock state lives in frontend memory, and this endpoint issues no
// token and grants no new access.
function verifyOwnPin(req, res) {
  res.json({ ok: true });
}

// PATCH /api/users/:id/password — OWNER only (👑) AND PIN-gated (📌, via requirePin in
// routes/users.js), unconditionally. This is an ADMIN reset, not a self-service change: the
// actor proves who THEY are (their own PIN, checked against req.user.id by requirePin — same
// as every other PIN gate in this app), then sets a brand-new password directly, no knowledge
// of the target's current password required. That's the whole point — it's how you hand a
// working login to someone who forgot theirs, or issue the first real password for an account
// whose password only the creator ever knew.
//
// Resetting your OWN password through this endpoint is allowed with no special-casing: you've
// already proven both an active session and your own PIN, which is at least as strong a bar as
// a typical "enter your current password" self-service flow would be, so there's no real gap
// to guard against.
//
// Resetting a DIFFERENT account's password is where this gets sensitive, and only in one case:
// if the target is an OWNER (not STAFF). Same restriction as createUser's OWNER-creation gate
// (rule 74) — a non-primary OWNER can fully manage STAFF, but cannot act on another OWNER
// account, including the primary owner's own. Without this check, any secondary OWNER could
// silently reset the primary owner's password and lock them out of their own account entirely
// — arguably a bigger risk than the OWNER-creation case rule 74 already covers, since this acts
// on an account that already exists rather than merely creating a new one.
async function resetUserPassword(req, res) {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'newPassword is required');
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return sendError(res, 404, 'USER_NOT_FOUND', `No user with id ${id}`);
  }

  if (target.role === 'OWNER' && target.id !== req.user.id && !req.user.isPrimaryOwner) {
    return sendError(res, 403, 'FORBIDDEN_ROLE', 'Only the primary owner can reset another OWNER\'s password');
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const user = await prisma.user.update({ where: { id }, data: { passwordHash }, select: SELECT });
  res.json(user);
}

// PATCH /api/users/:id — OWNER only (👑), no PIN. Edits name and/or username — never
// role/password/PIN, each of those already has its own dedicated endpoint with its own gating.
// Body is a partial: whichever of {name, username} is present gets updated, the other is left
// untouched (not overwritten with an empty value).
//
// Same isPrimaryOwner restriction as resetUserPassword above (rule 97): a non-primary OWNER can
// freely rename any STAFF account, and can rename themselves, but cannot touch a DIFFERENT
// OWNER's name/username without isPrimaryOwner — same reasoning, this acts on an account that
// already exists and a non-primary OWNER silently renaming another owner (least of all the
// primary owner) is a real risk this closes, not a hypothetical.
//
// Username uniqueness is enforced the exact same way createUser already does it — no separate
// pre-check, just attempt the write and let the DB's own @unique constraint reject a collision
// via P2002. That keeps the case-sensitivity behavior identical to account creation by
// construction (same constraint, same collation) rather than risking a second, subtly different
// check drifting out of sync with it over time.
async function updateUser(req, res) {
  const { id } = req.params;
  const { name, username } = req.body;

  if (name === undefined && username === undefined) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'At least one of name or username is required');
  }
  if (name !== undefined && !name) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name cannot be empty');
  }
  if (username !== undefined && !username) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'username cannot be empty');
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return sendError(res, 404, 'USER_NOT_FOUND', `No user with id ${id}`);
  }

  if (target.role === 'OWNER' && target.id !== req.user.id && !req.user.isPrimaryOwner) {
    return sendError(res, 403, 'FORBIDDEN_ROLE', 'Only the primary owner can edit another OWNER\'s details');
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (username !== undefined) data.username = username;

  try {
    const user = await prisma.user.update({ where: { id }, data, select: SELECT });
    res.json(user);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_USERNAME', `Username "${username}" already exists`);
    }
    throw err;
  }
}

module.exports = {
  listUsers,
  createUser,
  deactivateUser,
  reactivateUser,
  updateOwnPin,
  verifyOwnPin,
  resetUserPassword,
  updateUser,
};
