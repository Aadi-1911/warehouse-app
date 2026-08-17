const express = require('express');
const requireAuth = require('../middleware/auth');
const { createOrder, listOrders, getOrder, packOrder, shipOrder } = require('../controllers/orderController');

const router = express.Router();

router.get('/', requireAuth, listOrders);
router.get('/:id', requireAuth, getOrder);
router.post('/', requireAuth, createOrder);
router.patch('/:id/pack', requireAuth, packOrder);
router.patch('/:id/ship', requireAuth, shipOrder);

module.exports = router;
