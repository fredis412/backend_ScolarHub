const express = require('express');
const router = express.Router();
const notesController = require('../controllers/notes.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const gestion = require('../controllers/notesGestion.controller');

// Notes de l'étudiant connecté
router.get('/etudiant', authMiddleware, notesController.getNotesEtudiant);

// ✅ NOUVEAU — moyenne + taux de présence de l'étudiant connecté (remplace
// les requêtes Supabase directes de home_tab.dart, bloquées par RLS).
router.get('/mon-apercu', authMiddleware, notesController.getMonApercu);

// Export PDF des bulletins
router.get('/bulletin/:etudiantId', authMiddleware, notesController.generateBulletinPdf);

// Moyennes générales (admin)
router.get('/moyennes', authMiddleware, requireRole('admin'), notesController.getMoyennesAdmin);

// Notes individuelles très faibles (< 7), récentes — alerte tableau de bord (admin)
router.get('/blamables', authMiddleware, requireRole('admin'), notesController.getNotesBlamables);

// Sessions de notes — vue admin (toutes les sessions, tous profs confondus)
router.get('/sessions/admin/all', authMiddleware, requireRole('admin'), notesController.getAllSessionsAdmin);
// Gestion admin : stocker / transférer (en lot) / archiver — AVANT les routes /:session_id
router.patch('/sessions/admin/stocker', authMiddleware, requireRole('admin'), gestion.stockerSessions);
router.patch('/sessions/admin/transferer', authMiddleware, requireRole('admin'), gestion.transfererSessions);
router.patch('/sessions/admin/archiver', authMiddleware, requireRole('admin'), gestion.archiverSessions);

// Moyennes provisoires PAR MODULE (pas de moyenne générale)
router.get('/moyennes-provisoires/apercu', authMiddleware, requireRole('admin'), gestion.apercuMoyennesProvisoires);
router.post('/moyennes-provisoires/publier', authMiddleware, requireRole('admin'), gestion.publierMoyennesProvisoires);
router.get('/moyennes-provisoires/mes', authMiddleware, gestion.mesMoyennesProvisoires);

router.patch('/sessions/:session_id/valider', authMiddleware, requireRole('admin'), notesController.validateSessionAdmin);
router.patch('/sessions/:session_id/rejeter', authMiddleware, requireRole('admin'), notesController.rejectSessionAdmin);

// Sessions de notes — vue professeur/admin (création directe)
router.post('/sessions', authMiddleware, notesController.createGradeSession);
router.get('/sessions', authMiddleware, notesController.getGradeSessions);
router.get('/sessions/:session_id', authMiddleware, notesController.getSessionDetail);
router.get('/liste-classe', authMiddleware, notesController.getListeClasseAvecNotes);
router.get('/sessions/en-attente/count', authMiddleware, notesController.getNombreSessionsEnAttente);
router.put('/sessions/:session_id', authMiddleware, notesController.updateGradeSession);
router.patch('/sessions/:session_id/send', authMiddleware, notesController.markSessionSent);

module.exports = router;