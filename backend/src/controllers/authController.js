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

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role },
  });
}

// Lets the frontend ask "who am I, and as what role" — also doubles as proof the auth
// middleware is actually verifying tokens correctly.
async function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { login, me };
