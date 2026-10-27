const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const {
  getNotifications,
  getNombreNonLues,
  marquerCommeLue,
  marquerToutesLues,
} = require('../controllers/notifications.controller');

// GET /api/notifications - Liste des notifications
router.get('/', authMiddleware, getNotifications);

// GET /api/notifications/non-lues/count - Nombre de notifications non lues
// (déclarée avant /:id/lue pour éviter tout conflit de route paramétrique)
router.get('/non-lues/count', authMiddleware, getNombreNonLues);

// PATCH /api/notifications/:id/lue - Marquer une notification comme lue
router.patch('/:id/lue', authMiddleware, marquerCommeLue);

// PATCH /api/notifications/lire-tout - Marquer toutes comme lues
router.patch('/lire-tout', authMiddleware, marquerToutesLues);

module.exports = router;