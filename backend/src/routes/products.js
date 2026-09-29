const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requirePin } = require('../middleware/requirePin');
const {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deactivateProduct,
  reactivateProduct,
  getValidColors,
  setLocationPrice,
  setLocationPricingEnabled,
} = require('../controllers/productController');

const router = express.Router();

// PATCH only needs the PIN when the request actually touches a price field (04_API_SPEC.md
// §PATCH /api/products/:id) — this wraps the real requirePin middleware (not a reimplementation
// of its logic) so price edits chain requireRole AND requirePin, never either/or, while
// non-price edits skip straight past this to the handler. PATCH itself requires OWNER
// unconditionally (any edit, priced or not) — only the PIN is conditional on price fields.
function requirePinForPriceEdits(req, res, next) {
  const editingPrice = 'costPrice' in req.body || 'sellingPrice' in req.body;
  if (!editingPrice) return next();
  return requirePin(req, res, next);
}

// POST is different from PATCH: any authenticated role can create a Product at all, but the
// moment the body sets a real price, 04_API_SPEC.md says "the same rule as editing applies" —
// OWNER role AND PIN, together, with no exception for it happening at creation time. So unlike
// PATCH (where OWNER is unconditional and only the PIN is gated on price), here BOTH the role
// check and the PIN check are conditional on price fields being present. Chains manually
// rather than reusing requireRole('OWNER') as a plain route-level middleware, because it must
// only run when settingPrice is true — requireRole's own `next` becomes "now also check the
// PIN," not the route's real next(), so a failed role check (which already sent a response)
// never falls through to requirePin.
function requireOwnerPinForPriceFields(req, res, next) {
  const settingPrice = 'costPrice' in req.body || 'sellingPrice' in req.body;
  if (!settingPrice) return next();
  return requireRole('OWNER')(req, res, () => requirePin(req, res, next));
}

router.get('/', requireAuth, listProducts);
router.get('/:id', requireAuth, getProduct);
router.get('/:id/valid-colors', requireAuth, getValidColors);
// Any authenticated role can create with no price fields — staff create new articles during
// Receive Stock routinely, landing them in the pending-price state. Setting a real price at
// creation requires OWNER+PIN, exactly like editing one later (04_API_SPEC.md).
router.post('/', requireAuth, requireOwnerPinForPriceFields, createProduct);
router.patch('/:id', requireAuth, requireRole('OWNER'), requirePinForPriceEdits, updateProduct);
// Any authenticated role — matches createProduct's own base gating, not updateProduct's
// (deactivate is never a price action, so it's never OWNER+PIN-gated the way field edits are).
router.patch('/:id/deactivate', requireAuth, deactivateProduct);
router.patch('/:id/reactivate', requireAuth, reactivateProduct);

// Rule 111 (2026-09-23) — per-article, per-location pricing.
//
// NOTE the gate on the PUT below is requirePin DIRECTLY, not requirePinForPriceEdits. That is the
// whole point and it must not be "simplified" into the shared conditional guard later:
// requirePinForPriceEdits only asks the PIN when it spots 'costPrice'/'sellingPrice' at the TOP
// LEVEL of the body. It was written for PATCH /:id's flat body and is correct there. Routing a
// price write through any conditional check invites a future body shape that the check doesn't
// recognise — at which point a real price edit sails through with no PIN and nothing looks wrong.
// A price-writing route gets an unconditional PIN, full stop. See setLocationPrice's own comment
// in productController.js for the concrete bypass this avoids.
router.put(
  '/:id/location-prices/:locationId',
  requireAuth,
  requireRole('OWNER'),
  requirePin,
  setLocationPrice
);

// The toggle itself is OWNER-only but NOT PIN-gated — it writes no price, it only selects which
// already-PIN-gated price is read. Same treatment name/categoryId/isKids get on PATCH /:id.
router.patch('/:id/location-pricing', requireAuth, requireRole('OWNER'), setLocationPricingEnabled);

module.exports = router;
