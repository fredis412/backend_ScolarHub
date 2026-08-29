const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/professeurs.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// ── Routes publiques ──────────────────────────────────────────────────────────
// Lookup par nom + tel (pour la connexion)
router.get('/lookup', ctrl.lookupProfesseur);

// ── Routes admin ──────────────────────────────────────────────────────────────
router.get('/',    authMiddleware, requireRole('admin'), ctrl.getAllProfesseurs);
router.post('/',   authMiddleware, requireRole('admin'), ctrl.createProfesseur);
router.put('/:id', authMiddleware, requireRole('admin'), ctrl.updateProfesseur);
router.delete('/:id', authMiddleware, requireRole('admin'), ctrl.deleteProfesseur);

// ── Routes professeur connecté ────────────────────────────────────────────────
router.get('/profile',    authMiddleware, ctrl.getProfile);
router.put('/profile',    authMiddleware, ctrl.updateProfile);
router.get('/classes',    authMiddleware, ctrl.getClasses);
router.get('/modules',    authMiddleware, ctrl.getModules);
router.get('/:id',        authMiddleware, ctrl.getProfesseurById);
router.get('/:id/modules', authMiddleware, ctrl.getModulesByProfesseur);
router.get('/classes/:filiere_id/students', authMiddleware, ctrl.getStudentsByFiliere);

// ── Disponibilités ────────────────────────────────────────────────────────────
router.get('/disponibilites/all', authMiddleware, requireRole('admin'), ctrl.getAllDisponibilites);
router.get('/disponibilites',     authMiddleware, ctrl.getDisponibilites);
router.put('/disponibilites',     authMiddleware, ctrl.saveDisponibilites);

// ── Assignation modules ───────────────────────────────────────────────────────
router.patch('/assign-module', authMiddleware, requireRole('admin'), ctrl.patchModuleAssignment);

module.exports = router;
