const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { createTransferCorrection } = require('../controllers/transferCorrectionController');

const router = express.Router();

// OWNER only, no PIN — a Transfer never touches price (unlike routes/transactionCorrections.js,
// which conditionally gates on costPrice), so there's no PIN branch to build here at all.
router.post('/', requireAuth, requireRole('OWNER'), createTransferCorrection);

module.exports = router;
