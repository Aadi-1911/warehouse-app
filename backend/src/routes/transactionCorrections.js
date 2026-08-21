const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requirePin } = require('../middleware/requirePin');
const { createTransactionCorrection } = require('../controllers/transactionCorrectionController');

const router = express.Router();

// PIN only when the correction actually touches cost price (04_API_SPEC.md) — identical shape to
// routes/products.js's requirePinForPriceEdits, not a reimplementation. Role is unconditional
// (OWNER for every correction, priced or not); only the PIN is gated on price.
function requirePinForPriceCorrection(req, res, next) {
  const correctingPrice = 'costPrice' in req.body;
  if (!correctingPrice) return next();
  return requirePin(req, res, next);
}

router.post('/', requireAuth, requireRole('OWNER'), requirePinForPriceCorrection, createTransactionCorrection);

module.exports = router;
