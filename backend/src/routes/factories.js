const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  listFactories,
  createFactory,
  updateFactory,
  deactivateFactory,
  reactivateFactory,
  getFactoryPayable,
  getFactoriesRevenue,
  getFactoriesSoldVsSitting,
} = require('../controllers/factoryController');

const router = express.Router();

router.get('/', requireAuth, listFactories);
router.post('/', requireAuth, createFactory);
// Static /analytics/* segments, placed before /:id so they can never be swallowed by a future
// single-segment :id route — matches the defensive ordering already used for /:id/payable's own
// literal suffix. OWNER only, same gating as GET /api/locations/revenue.
router.get('/analytics/revenue', requireAuth, requireRole('OWNER'), getFactoriesRevenue);
router.get('/analytics/sold-vs-sitting', requireAuth, requireRole('OWNER'), getFactoriesSoldVsSitting);
router.patch('/:id', requireAuth, requireRole('OWNER'), updateFactory);
// Any authenticated role — matches createFactory's own gating, not updateFactory's (deactivate
// is a distinct action from editing GST/contact, same split userController.js draws between
// deactivate/reactivate and any future OWNER-only field edit).
router.patch('/:id/deactivate', requireAuth, deactivateFactory);
router.patch('/:id/reactivate', requireAuth, reactivateFactory);
// Owner-only per 04_API_SPEC.md's corrected marker — see factoryController.js's comment on why
// this had to change from an earlier any-role draft (costPriceSnapshot-derived, reverse-
// engineerable into cost price by anyone who already knows quantities received).
router.get('/:id/payable', requireAuth, requireRole('OWNER'), getFactoryPayable);

module.exports = router;
