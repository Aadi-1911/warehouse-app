const express = require('express');
const requireAuth = require('../middleware/auth');
const { listColors, createColor, deactivateColor, reactivateColor } = require('../controllers/colorController');

const router = express.Router();

router.get('/', requireAuth, listColors);
router.post('/', requireAuth, createColor);
router.patch('/:id/deactivate', requireAuth, deactivateColor);
router.patch('/:id/reactivate', requireAuth, reactivateColor);

module.exports = router;
