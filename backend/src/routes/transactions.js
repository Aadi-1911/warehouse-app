const express = require('express');
const requireAuth = require('../middleware/auth');
const { createTransaction, listTransactions } = require('../controllers/transactionController');

const router = express.Router();

router.get('/', requireAuth, listTransactions);
router.post('/', requireAuth, createTransaction);

module.exports = router;
