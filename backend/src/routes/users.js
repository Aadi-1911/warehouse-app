const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { listUsers, createUser } = require('../controllers/userController');

const router = express.Router();

router.get('/', requireAuth, requireRole('OWNER'), listUsers);
router.post('/', requireAuth, requireRole('OWNER'), createUser);

module.exports = router;
