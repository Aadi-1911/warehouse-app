const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  listUsers,
  createUser,
  deactivateUser,
  reactivateUser,
  updateOwnPin,
} = require('../controllers/userController');

const router = express.Router();

router.get('/', requireAuth, requireRole('OWNER'), listUsers);
router.post('/', requireAuth, requireRole('OWNER'), createUser);
// Registered ahead of the /:id/* routes on principle (static path segments before dynamic
// ones) — no actual collision today since /:id/deactivate and /:id/reactivate both end in a
// static suffix that /me/pin doesn't share, but this ordering costs nothing and avoids ever
// having to think about it if a plain /:id route is added later.
router.patch('/me/pin', requireAuth, requireRole('OWNER'), updateOwnPin);
router.patch('/:id/deactivate', requireAuth, requireRole('OWNER'), deactivateUser);
router.patch('/:id/reactivate', requireAuth, requireRole('OWNER'), reactivateUser);

module.exports = router;
