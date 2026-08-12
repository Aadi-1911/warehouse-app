const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { deactivateParty, reactivateParty } = require('../controllers/partyController');

const router = express.Router();

// No GET/POST here — Party has no create/list endpoint yet (out of scope for this task, only
// deactivate/reactivate were requested). OWNER only, per an explicit decision made when adding
// these two endpoints: Party has no existing creation gate to mirror the way the other four
// entities' deactivate endpoints do.
router.patch('/:id/deactivate', requireAuth, requireRole('OWNER'), deactivateParty);
router.patch('/:id/reactivate', requireAuth, requireRole('OWNER'), reactivateParty);

module.exports = router;
