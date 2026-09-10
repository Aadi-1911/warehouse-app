const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requirePin } = require('../middleware/requirePin');
const { createPartyDebit } = require('../controllers/partyDebitController');

const router = express.Router();

// OWNER + PIN gated, identical shape to POST /api/factory-debits — this is an equally sensitive
// financial action, just increasing amountDue instead of decreasing it.
router.post('/', requireAuth, requireRole('OWNER'), requirePin, createPartyDebit);

module.exports = router;
