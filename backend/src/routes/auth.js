const express = require('express');
const requireAuth = require('../middleware/auth');
const { login, me } = require('../controllers/authController');

const router = express.Router();

router.post('/login', login);
router.get('/me', requireAuth, me);

module.exports = router;
