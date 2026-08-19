const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { getOverview } = require('../controllers/dashboardController');

const router = express.Router();

// OWNER only, enforced by real middleware rather than by the route being hard to find. The
// response is derived from Product.costPrice, which CLAUDE.md forbids reaching a STAFF request
// under any circumstance — and this project has shipped a role-gate mistake before
// (POST /api/bundles, see LEARNING_LOG.md), so this gate is deliberate, not inherited.
router.get('/overview', requireAuth, requireRole('OWNER'), getOverview);

module.exports = router;
