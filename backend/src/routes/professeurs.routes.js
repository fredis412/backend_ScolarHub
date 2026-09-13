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
// IMPORTANT : les routes statiques (/profile, /classes, /modules, /disponibilites)
// DOIVENT être déclarées AVANT les routes paramétrées (/:id) pour qu'Express
// ne les intercepte pas à tort.
router.get('/profile',    authMiddleware, ctrl.getProfile);
router.put('/profile',    authMiddleware, ctrl.updateProfile);

// Classes & modules
router.get('/classes',                                  authMiddleware, ctrl.getClasses);
router.get('/classes/:filiere_id/students',             authMiddleware, ctrl.getStudentsByFiliere);
router.get('/classes/:filiere_id/students/pdf',         authMiddleware, ctrl.getStudentsByFilierePdf);
router.get('/modules',                                  authMiddleware, ctrl.getModules);

// Disponibilités (avant /:id pour éviter le conflit)
router.get('/disponibilites/all', authMiddleware, requireRole('admin'), ctrl.getAllDisponibilites);
router.get('/disponibilites',     authMiddleware, ctrl.getDisponibilites);
router.put('/disponibilites',     authMiddleware, ctrl.saveDisponibilites);

// Assignation modules (avant /:id)
router.patch('/assign-module', authMiddleware, requireRole('admin'), ctrl.patchModuleAssignment);

// ── Routes paramétrées (en DERNIER pour ne pas capturer les routes statiques) ─
router.get('/:id',         authMiddleware, ctrl.getProfesseurById);
router.get('/:id/modules', authMiddleware, ctrl.getModulesByProfesseur);

module.exports = router;
