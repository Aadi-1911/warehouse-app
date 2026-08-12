const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { listParties, createParty, deactivateParty, reactivateParty } = require('../controllers/partyController');

const router = express.Router();

router.get('/', requireAuth, listParties);
router.post('/', requireAuth, requireRole('OWNER'), createParty);
router.patch('/:id/deactivate', requireAuth, requireRole('OWNER'), deactivateParty);
router.patch('/:id/reactivate', requireAuth, requireRole('OWNER'), reactivateParty);

module.exports = router;
