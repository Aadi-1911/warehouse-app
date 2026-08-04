const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const requirePin = require('../middleware/requirePin');
const {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  getValidColors,
} = require('../controllers/productController');

const router = express.Router();

// PATCH only needs the PIN when the request actually touches a price field (04_API_SPEC.md
// §PATCH /api/products/:id) — this wraps the real requirePin middleware (not a reimplementation
// of its logic) so price edits chain requireRole AND requirePin, never either/or, while
// non-price edits skip straight past this to the handler.
function requirePinForPriceEdits(req, res, next) {
  const editingPrice = 'costPrice' in req.body || 'sellingPrice' in req.body;
  if (!editingPrice) return next();
  return requirePin(req, res, next);
}

router.get('/', requireAuth, listProducts);
router.get('/:id', requireAuth, getProduct);
router.get('/:id/valid-colors', requireAuth, getValidColors);
router.post('/', requireAuth, requireRole('OWNER'), createProduct);
router.patch('/:id', requireAuth, requireRole('OWNER'), requirePinForPriceEdits, updateProduct);

module.exports = router;
