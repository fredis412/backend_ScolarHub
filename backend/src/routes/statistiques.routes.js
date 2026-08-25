const express = require('express');
const router = express.Router();
const { getNotesStatistiques } = require('../controllers/statistiques.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// GET /api/statistiques/notes - Admin dashboard
router.get('/notes', authMiddleware, requireRole('admin', 'direction'), getNotesStatistiques);

module.exports = router;
