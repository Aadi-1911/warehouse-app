const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requirePin } = require('../middleware/requirePin');
const { createFactoryPayment } = require('../controllers/factoryPaymentController');

const router = express.Router();

// PIN-gated as of the Factory Payables screen task: originally shipped OWNER-role-only, no PIN
// (see the now-corrected comment in factoryPaymentController.js for the original reasoning).
// Revisited when building the screen's Record Payment flow, which needed a real, enforced PIN
// step rather than a decorative one — see LEARNING_LOG.md for the full reasoning.
router.post('/', requireAuth, requireRole('OWNER'), requirePin, createFactoryPayment);

module.exports = router;
