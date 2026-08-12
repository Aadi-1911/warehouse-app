const express = require('express');
const requireAuth = require('../middleware/auth');
const { listCategories, createCategory } = require('../controllers/categoryController');

const router = express.Router();

router.get('/', requireAuth, listCategories);
router.post('/', requireAuth, createCategory);

module.exports = router;
