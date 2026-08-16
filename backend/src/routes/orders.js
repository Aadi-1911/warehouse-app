const express = require('express');
const requireAuth = require('../middleware/auth');
const { createOrder, listOrders, getOrder } = require('../controllers/orderController');

const router = express.Router();

router.get('/', requireAuth, listOrders);
router.get('/:id', requireAuth, getOrder);
router.post('/', requireAuth, createOrder);

module.exports = router;
