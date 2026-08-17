const express = require('express');
const requireAuth = require('../middleware/auth');
const { listHistory } = require('../controllers/historyController');

const router = express.Router();

// Any authenticated role — both OWNER and STAFF see the identical feed, with no role-based
// filtering of content. Nothing price-related appears in the response, so there's no cost-price
// exposure to gate on (historyController selects no price field of any kind).
router.get('/', requireAuth, listHistory);

module.exports = router;
