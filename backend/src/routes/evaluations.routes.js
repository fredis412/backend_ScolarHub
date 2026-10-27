const express = require('express');
const router = express.Router();
const evaluationController = require('../controllers/evaluation.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// ── Étudiant ────────────────────────────────────────────────────────────
router.get('/a-faire', authMiddleware, requireRole('etudiant'), evaluationController.getEvaluationsAFaire);
router.post('/', authMiddleware, requireRole('etudiant'), evaluationController.soumettreEvaluation);

// ── Admin (déclarées avant toute route paramétrique générique) ──────────
router.post('/periodes', authMiddleware, requireRole('admin', 'direction'), evaluationController.creerPeriode);
router.get('/periodes', authMiddleware, requireRole('admin', 'direction'), evaluationController.getPeriodes);
router.patch('/periodes/:id/cloturer', authMiddleware, requireRole('admin', 'direction'), evaluationController.cloturerPeriode);
router.get('/periodes/:id/resultats', authMiddleware, requireRole('admin', 'direction'), evaluationController.getResultatsPeriode);

module.exports = router;