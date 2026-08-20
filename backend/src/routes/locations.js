const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  listLocations,
  createLocation,
  deactivateLocation,
  reactivateLocation,
  updateProfitShare,
} = require('../controllers/locationController');

const router = express.Router();

router.get('/', requireAuth, listLocations);
router.post('/', requireAuth, requireRole('OWNER'), createLocation);
router.patch('/:id/deactivate', requireAuth, requireRole('OWNER'), deactivateLocation);
router.patch('/:id/reactivate', requireAuth, requireRole('OWNER'), reactivateLocation);
router.patch('/:id/profit-share', requireAuth, requireRole('OWNER'), updateProfitShare);

module.exports = router;
