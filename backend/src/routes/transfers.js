const express = require('express');
const requireAuth = require('../middleware/auth');
const { createTransfer, listTransfers } = require('../controllers/transferController');

const router = express.Router();

router.get('/', requireAuth, listTransfers);
router.post('/', requireAuth, createTransfer);

module.exports = router;
