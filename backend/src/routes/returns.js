const express = require('express');
const requireAuth = require('../middleware/auth');
const { createReturns, listReturns } = require('../controllers/returnController');

const router = express.Router();

// Both any-role (requireAuth only, no requireRole). Receiving returned goods at the counter is a
// staff job — the same staff-primary reasoning that governs POST /api/orders and Receive Stock.
// This project has shipped one OWNER-only gate on a staff-primary flow by accident before
// (POST /api/bundles, see LEARNING_LOG.md), so this is a deliberate choice, not a default.
router.get('/', requireAuth, listReturns);
router.post('/', requireAuth, createReturns);

module.exports = router;
