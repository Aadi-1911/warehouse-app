const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requirePin } = require('../middleware/requirePin');
const {
  createFactoryDebit,
  updateFactoryDebit,
  updateFactoryDebitBillNo,
  deleteFactoryDebit,
} = require('../controllers/factoryDebitController');

const router = express.Router();

// OWNER + PIN gated, identical shape to POST /api/factory-payments — this is an equally
// sensitive financial action, just increasing amountPayable instead of decreasing it.
router.post('/', requireAuth, requireRole('OWNER'), requirePin, createFactoryDebit);
router.patch('/:id', requireAuth, requireRole('OWNER'), requirePin, updateFactoryDebit);
// Deliberately NOT requirePin, unlike every other write above — this one cannot change any
// amount, only the reference tag. See the handler's own comment for the full reasoning.
router.patch('/:id/bill-no', requireAuth, requireRole('OWNER'), updateFactoryDebitBillNo);
router.delete('/:id', requireAuth, requireRole('OWNER'), requirePin, deleteFactoryDebit);

module.exports = router;
