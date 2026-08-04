const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// Verifies the JWT from the Authorization header and attaches the current user to req.user.
// Re-fetches role from the database on every request instead of trusting the token's payload —
// a still-valid old token must not keep granting a role the user no longer has (see LEARNING_LOG.md).
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'UNAUTHENTICATED', 'Missing or malformed Authorization header');
  }

  const token = authHeader.slice('Bearer '.length);

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired token');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    return sendError(res, 401, 'USER_NOT_FOUND', 'User no longer exists');
  }

  req.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  next();
}

module.exports = requireAuth;
