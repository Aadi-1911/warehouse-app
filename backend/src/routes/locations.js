const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { listLocations, createLocation } = require('../controllers/locationController');

const router = express.Router();

router.get('/', requireAuth, listLocations);
router.post('/', requireAuth, requireRole('OWNER'), createLocation);

module.exports = router;
