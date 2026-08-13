const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requirePin } = require('../middleware/requirePin');
const { createFactoryDebit } = require('../controllers/factoryDebitController');

const router = express.Router();

// OWNER + PIN gated, identical shape to POST /api/factory-payments — this is an equally
// sensitive financial action, just increasing amountPayable instead of decreasing it.
router.post('/', requireAuth, requireRole('OWNER'), requirePin, createFactoryDebit);

module.exports = router;
