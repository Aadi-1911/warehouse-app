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

async function requirePin(req, res, next) {
  const { pin } = req.body;
  if (!pin) {
    return sendError(res, 403, 'MISSING_PIN', 'pin is required');
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    return sendError(res, 401, 'USER_NOT_FOUND', 'User no longer exists');
  }

  if (!user.priceEditPinHash) {
    return sendError(res, 403, 'PIN_NOT_SET', 'No price-edit PIN is set for this account');
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.pinLockedUntil - new Date()) / 60000);
    return sendError(
      res,
      403,
      'PIN_LOCKED',
      `PIN locked after too many failed attempts. Try again in ${minutesLeft} minute(s).`
    );
  }

  const pinMatches = await bcrypt.compare(pin, user.priceEditPinHash);

  if (pinMatches) {
    // Successful entry clears any prior failure streak — attempts don't accumulate across
    // separate correct/incorrect sessions, only consecutive failures count.
    if (user.failedPinAttempts !== 0 || user.pinLockedUntil !== null) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedPinAttempts: 0, pinLockedUntil: null },
      });
    }
    return next();
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
    return sendError(res, 403, 'PIN_LOCKED', `Too many failed PIN attempts. Locked for ${LOCKOUT_MINUTES} minutes.`);
  }

  return sendError(res, 403, 'INVALID_PIN', 'Invalid PIN', {
    attemptsRemaining: MAX_ATTEMPTS - failedPinAttempts,
  });
}

module.exports = requirePin;
