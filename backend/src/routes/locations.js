const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  listLocations,
  createLocation,
  deactivateLocation,
  reactivateLocation,
  updateProfitShare,
  getLocationsRevenue,
} = require('../controllers/locationController');

const router = express.Router();

router.get('/', requireAuth, listLocations);
// No :id route exists at this path depth, so /revenue as a static segment can't collide with a
// dynamic :id param — safe to add without reordering anything above it.
router.get('/revenue', requireAuth, requireRole('OWNER'), getLocationsRevenue);
router.post('/', requireAuth, requireRole('OWNER'), createLocation);
router.patch('/:id/deactivate', requireAuth, requireRole('OWNER'), deactivateLocation);
router.patch('/:id/reactivate', requireAuth, requireRole('OWNER'), reactivateLocation);
router.patch('/:id/profit-share', requireAuth, requireRole('OWNER'), updateProfitShare);

module.exports = router;
