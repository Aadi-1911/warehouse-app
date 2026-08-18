const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  createOrder,
  listOrders,
  getOrder,
  packOrder,
  billOrder,
  shipOrder,
  cancelOrderLine,
  cancelOrder,
} = require('../controllers/orderController');

const router = express.Router();

router.get('/', requireAuth, listOrders);
router.get('/:id', requireAuth, getOrder);
router.post('/', requireAuth, createOrder);
router.patch('/:id/pack', requireAuth, packOrder);
// The one order transition that is NOT any-role: rule 63 states plainly that "... → Billed" is
// owner-only and must never be offered to STAFF. Gated by real middleware, not a comment —
// this project has shipped a role-gate mistake before (POST /api/bundles, see LEARNING_LOG.md).
router.patch('/:id/bill', requireAuth, requireRole('OWNER'), billOrder);
router.patch('/:id/ship', requireAuth, shipOrder);
// Cancellation is OWNER-only, like billing — it voids real committed work and, unlike packing,
// isn't something staff should be able to do unilaterally. The more specific /lines/... route is
// declared before /:id/cancel purely for readability; Express matches on the full path, so their
// order relative to each other doesn't actually matter here.
router.patch('/:id/lines/:lineItemId/cancel', requireAuth, requireRole('OWNER'), cancelOrderLine);
router.patch('/:id/cancel', requireAuth, requireRole('OWNER'), cancelOrder);

module.exports = router;
