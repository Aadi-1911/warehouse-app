const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requirePin } = require('../middleware/requirePin');
const {
  listUsers,
  createUser,
  deactivateUser,
  reactivateUser,
  updateOwnPin,
  verifyOwnPin,
  resetUserPassword,
} = require('../controllers/userController');

const router = express.Router();

router.get('/', requireAuth, requireRole('OWNER'), listUsers);
router.post('/', requireAuth, requireRole('OWNER'), createUser);
// Registered ahead of the /:id/* routes on principle (static path segments before dynamic
// ones) — no actual collision today since /:id/deactivate, /:id/reactivate, and /:id/password
// all end in a static suffix that /me/pin doesn't share, but this ordering costs nothing and
// avoids ever having to think about it if a plain /:id route is added later.
router.patch('/me/pin', requireAuth, requireRole('OWNER'), updateOwnPin);
// Same static-before-dynamic placement as /me/pin above. requirePin does the whole verification
// (identical lockout counters to every other PIN gate); verifyOwnPin only reports success.
router.post('/me/verify-pin', requireAuth, requireRole('OWNER'), requirePin, verifyOwnPin);
router.patch('/:id/deactivate', requireAuth, requireRole('OWNER'), deactivateUser);
router.patch('/:id/reactivate', requireAuth, requireRole('OWNER'), reactivateUser);
// PIN-gated like a price edit (CLAUDE.md) — resetting someone's login is at least as sensitive.
router.patch('/:id/password', requireAuth, requireRole('OWNER'), requirePin, resetUserPassword);

module.exports = router;
