const express = require('express');
const requireAuth = require('../middleware/auth');
const { listHistory } = require('../controllers/historyController');

const router = express.Router();

// Any authenticated role can call this — but the two roles do NOT get the same feed (rule 104,
// added 2026-08-26). OWNER receives every entry; STAFF receives only entries for actions performed
// by a STAFF user, shared across all staff rather than narrowed to the caller. That branch lives
// in historyController itself, not here, because it filters WHICH ROWS come back rather than
// whether the route may be called at all — requireRole can only express the latter. Nothing
// price-related appears in the response at either role (historyController selects no price field
// of any kind), so cost-price exposure is a separate concern this filter doesn't touch.
router.get('/', requireAuth, listHistory);

module.exports = router;
