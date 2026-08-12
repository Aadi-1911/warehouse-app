const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { createFactoryPayment } = require('../controllers/factoryPaymentController');

const router = express.Router();

router.post('/', requireAuth, requireRole('OWNER'), createFactoryPayment);

module.exports = router;
