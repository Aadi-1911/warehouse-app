const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true, username: true, role: true };
const VALID_ROLES = ['OWNER', 'STAFF'];
const SALT_ROUNDS = 10; // matches seed.js — same hashing strength for every password in this app

// GET /api/users — OWNER only (👑). passwordHash/priceEditPinHash are never SELECTed — same
// pattern as costPrice's OWNER-only visibility in productController.js: the fields don't exist
// on the fetched object at all, not "fetched then stripped before responding."
async function listUsers(req, res) {
  const users = await prisma.user.findMany({ select: SELECT });
  res.json(users);
}

// POST /api/users — OWNER only (👑)
async function createUser(req, res) {
  const { name, username, password, role } = req.body;

  if (!name || !username || !password || !role) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name, username, password, and role are required');
  }
  if (!VALID_ROLES.includes(role)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `role must be one of: ${VALID_ROLES.join(', ')}`);
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

module.exports = { listUsers, createUser };
