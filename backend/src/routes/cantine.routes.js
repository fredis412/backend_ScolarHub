const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const cantineController = require('../controllers/cantine.controller');

// Lecture du menu publié du jour — accessible à tout rôle connecté
// (étudiant, parent, prof, admin).
router.get('/aujourdhui', authMiddleware, cantineController.getMenuAujourdhui);

// Écran d'édition (admin / cantinière) : voir et publier un menu.
router.get('/jour', authMiddleware, requireRole('admin'), cantineController.getMenuJour);
router.post('/publier', authMiddleware, requireRole('admin'), cantineController.publierMenu);

module.exports = router;
