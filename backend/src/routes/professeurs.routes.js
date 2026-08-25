const express = require('express');
const router = express.Router();
const professeursController = require('../controllers/professeurs.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// Liste des professeurs (admin : attribution de modules)
router.get('/', authMiddleware, requireRole('admin'), professeursController.listProfesseurs);

router.get('/profile', authMiddleware, professeursController.getProfile);
router.put('/profile', authMiddleware, professeursController.updateProfile);
router.get('/classes', authMiddleware, professeursController.getClasses);
router.get('/modules', authMiddleware, professeursController.getModules);
router.get('/classes/:filiere_id/students', authMiddleware, professeursController.getStudentsByFiliere);

// Disponibilités (heures libres transmises à l'administration)
router.get('/disponibilites/all', authMiddleware, requireRole('admin'), professeursController.getAllDisponibilites);
router.get('/disponibilites', authMiddleware, professeursController.getDisponibilites);
router.put('/disponibilites', authMiddleware, professeursController.saveDisponibilites);

module.exports = router;
