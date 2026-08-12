const express = require('express');
const requireAuth = require('../middleware/auth');
const { listCategories, createCategory, deactivateCategory, reactivateCategory } = require('../controllers/categoryController');

const router = express.Router();

router.get('/', requireAuth, listCategories);
router.post('/', requireAuth, createCategory);
router.patch('/:id/deactivate', requireAuth, deactivateCategory);
router.patch('/:id/reactivate', requireAuth, reactivateCategory);

module.exports = router;
