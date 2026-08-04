const express = require('express');
const requireAuth = require('../middleware/auth');
const { listColors, createColor } = require('../controllers/colorController');

const router = express.Router();

router.get('/', requireAuth, listColors);
router.post('/', requireAuth, createColor);

module.exports = router;
