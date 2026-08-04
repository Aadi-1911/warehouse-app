const express = require('express');
const requireAuth = require('../middleware/auth');
const { listFactories, createFactory } = require('../controllers/factoryController');

const router = express.Router();

router.get('/', requireAuth, listFactories);
router.post('/', requireAuth, createFactory);

module.exports = router;
