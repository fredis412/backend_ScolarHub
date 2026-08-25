const express = require('express');
const router = express.Router();
const notesController = require('../controllers/notes.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// Notes de l'étudiant connecté
router.get('/etudiant', authMiddleware, notesController.getNotesEtudiant);

// Export PDF des bulletins
router.get('/bulletin/:etudiantId', authMiddleware, notesController.generateBulletinPdf);

// Moyennes générales (admin)
router.get('/moyennes', authMiddleware, requireRole('admin'), notesController.getMoyennesAdmin);

// Sessions de notes — vue admin (toutes les sessions, tous profs confondus)
router.get('/sessions/admin/all', authMiddleware, requireRole('admin'), notesController.getAllSessionsAdmin);
router.patch('/sessions/:session_id/valider', authMiddleware, requireRole('admin'), notesController.validateSessionAdmin);
router.patch('/sessions/:session_id/rejeter', authMiddleware, requireRole('admin'), notesController.rejectSessionAdmin);

// Sessions de notes — vue professeur/admin (création directe)
router.post('/sessions', authMiddleware, notesController.createGradeSession);
router.get('/sessions', authMiddleware, notesController.getGradeSessions);
router.get('/sessions/:session_id', authMiddleware, notesController.getSessionDetail);
router.put('/sessions/:session_id', authMiddleware, notesController.updateGradeSession);
router.patch('/sessions/:session_id/send', authMiddleware, notesController.markSessionSent);

module.exports = router;
