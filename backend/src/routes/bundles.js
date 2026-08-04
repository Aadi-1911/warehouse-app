const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { listBundles, createBundle } = require('../controllers/bundleController');

const router = express.Router();

router.get('/', requireAuth, listBundles);
router.post('/', requireAuth, requireRole('OWNER'), createBundle);

module.exports = router;
