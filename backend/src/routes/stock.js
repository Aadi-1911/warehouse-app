const express = require('express');
const requireAuth = require('../middleware/auth');
const { listStock } = require('../controllers/stockController');

const router = express.Router();

router.get('/', requireAuth, listStock);

module.exports = router;
