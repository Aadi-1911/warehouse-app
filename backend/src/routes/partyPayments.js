const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requirePin } = require('../middleware/requirePin');
const {
  createPartyPayment,
  updatePartyPayment,
  deletePartyPayment,
} = require('../controllers/partyPaymentController');

const router = express.Router();

// OWNER + PIN unconditionally on all three — every field on this resource is financial, same
// gating as routes/factoryPayments.js.
router.post('/', requireAuth, requireRole('OWNER'), requirePin, createPartyPayment);
router.patch('/:id', requireAuth, requireRole('OWNER'), requirePin, updatePartyPayment);
router.delete('/:id', requireAuth, requireRole('OWNER'), requirePin, deletePartyPayment);

module.exports = router;
