const express = require('express');
const requireAuth = require('../middleware/auth');
const { listBundles, createBundle } = require('../controllers/bundleController');

const router = express.Router();

router.get('/', requireAuth, listBundles);
// Any authenticated role — matches POST /api/products, /api/colors, and /api/transactions'
// own gating, the other three steps of the exact same "staff receives a brand-new article"
// flow (05_BUSINESS_RULES.md rule 71, 04_API_SPEC.md). Was incorrectly requireRole('OWNER')
// from this project's second commit onward — a Bundle carries no price and creates nothing an
// OWNER needs to gate, the same reasoning already applied to every sibling creation endpoint
// here. See LEARNING_LOG.md for the full incident writeup.
router.post('/', requireAuth, createBundle);

module.exports = router;
