const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const TOKEN_EXPIRY = '7d'; // internal tool, small user count — long-lived tokens trade some revocability for not re-logging-in constantly

async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'username and password are required');
  }

  const user = await prisma.user.findUnique({ where: { username } });

  // Same error for "no such user" and "wrong password" — telling them apart lets an attacker
  // enumerate valid usernames.
  const invalidCredentials = () => sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password');

  if (!user) {
    return invalidCredentials();
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return invalidCredentials();
  }

  // Checked AFTER password verification, deliberately — checking first would let someone who
  // doesn't even know the password distinguish "deactivated account" from "wrong password,"
  // a new enumeration leak on top of the existing one this function already guards against.
  // Checked here too (not just requireAuth) so a freshly-deactivated user gets a clear, honest
  // reason at login rather than a generic invalid-credentials message.
  if (!user.isActive) {
    return sendError(res, 403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated');
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

  res.json({
    token,
    // Matches the exact shape auth.js's requireAuth attaches to req.user for GET /api/auth/me
    // — the two paths a client learns "who am I" must never disagree, or a page that reads
    // isPrimaryOwner right after login (vs. after a refresh) would silently see a different,
    // incomplete user object depending purely on which of the two calls it happened to go through.
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      isPrimaryOwner: user.isPrimaryOwner,
      hasPinSet: !!user.priceEditPinHash,
    },
  });
}

// Lets the frontend ask "who am I, and as what role" — also doubles as proof the auth
// middleware is actually verifying tokens correctly.
async function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { login, me };
