const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const {
  getNotifications,
  marquerCommeLue,
  marquerToutesLues,
} = require('../controllers/notifications.controller');

// GET /api/notifications - Liste des notifications
router.get('/', authMiddleware, getNotifications);

// PATCH /api/notifications/:id/lue - Marquer une notification comme lue
router.patch('/:id/lue', authMiddleware, marquerCommeLue);

// PATCH /api/notifications/lire-tout - Marquer toutes comme lues
router.patch('/lire-tout', authMiddleware, marquerToutesLues);

module.exports = router;
