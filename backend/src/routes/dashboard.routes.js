const express = require('express');
const router = express.Router();
const { getAdminDashboard } = require('../controllers/dashboard.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/dashboard/admin
router.get('/admin', authMiddleware, requireRole('admin', 'direction'), getAdminDashboard);

module.exports = router;
