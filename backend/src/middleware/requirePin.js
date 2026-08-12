const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// Must run after requireAuth + requireRole('OWNER') — assumes req.user.id is already verified
// to belong to an OWNER. Verifies a PIN submitted in req.body.pin against that user's
// priceEditPinHash (02_ARCHITECTURE.md §4.3). This is the SECOND, action-specific check —
// role alone is never enough to edit costPrice/sellingPrice (see CLAUDE.md's non-negotiable rules).
//
// Status codes follow 04_API_SPEC.md's error convention table, which explicitly puts
// "missing/invalid PIN" under 403 (not 400/401) — so every rejection path here is a 403.

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Core PIN-verification-with-lockout logic, extracted so it can be shared by TWO call sites:
// this file's own `requirePin` middleware (gates price edits on Products), and
// PATCH /api/users/me/pin's currentPin check (verifies knowledge of the existing PIN before
// accepting a change). Same secret, same brute-force risk, same lockout counters — duplicating
// this logic in two places would risk them drifting (e.g. a MAX_ATTEMPTS change landing in only
// one). Returns a plain result object rather than sending a response itself, since the two
// callers need to do different things with a failure (middleware calls next() vs sendError;
// the PATCH controller continues its own logic on success instead of just letting a request through).
async function verifyPin(userId, suppliedPin) {
  if (!suppliedPin) {
    return { ok: false, status: 403, code: 'MISSING_PIN', message: 'pin is required' };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { ok: false, status: 401, code: 'USER_NOT_FOUND', message: 'User no longer exists' };
  }

  if (!user.priceEditPinHash) {
    return { ok: false, status: 403, code: 'PIN_NOT_SET', message: 'No price-edit PIN is set for this account' };
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.pinLockedUntil - new Date()) / 60000);
    return {
      ok: false,
      status: 403,
      code: 'PIN_LOCKED',
      message: `PIN locked after too many failed attempts. Try again in ${minutesLeft} minute(s).`,
    };
  }

  const pinMatches = await bcrypt.compare(suppliedPin, user.priceEditPinHash);

  if (pinMatches) {
    // Successful entry clears any prior failure streak — attempts don't accumulate across
    // separate correct/incorrect sessions, only consecutive failures count.
    if (user.failedPinAttempts !== 0 || user.pinLockedUntil !== null) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedPinAttempts: 0, pinLockedUntil: null },
      });
    }
    return { ok: true };
  }

  const failedPinAttempts = user.failedPinAttempts + 1;
  const lockingOut = failedPinAttempts >= MAX_ATTEMPTS;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedPinAttempts: lockingOut ? 0 : failedPinAttempts,
      pinLockedUntil: lockingOut ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null,
    },
  });

  if (lockingOut) {
    return {
      ok: false,
      status: 403,
      code: 'PIN_LOCKED',
      message: `Too many failed PIN attempts. Locked for ${LOCKOUT_MINUTES} minutes.`,
    };
  }

  return {
    ok: false,
    status: 403,
    code: 'INVALID_PIN',
    message: 'Invalid PIN',
    extra: { attemptsRemaining: MAX_ATTEMPTS - failedPinAttempts },
  };
}

async function requirePin(req, res, next) {
  const result = await verifyPin(req.user.id, req.body.pin);
  if (result.ok) return next();
  return sendError(res, result.status, result.code, result.message, result.extra || {});
}

module.exports = { requirePin, verifyPin };
