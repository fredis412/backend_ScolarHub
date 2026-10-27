const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { upload, uploadToCloudinary } = require('../middleware/upload.middleware');
const c = require('../controllers/reclamations.controller');

// Étudiant
router.post('/', authMiddleware, c.createReclamation);
router.get('/mes-reclamations', authMiddleware, c.getMesReclamations);

// Professeur (avant /:id)
router.get('/professeur/mes', authMiddleware, requireRole('professeur'), c.getReclamationsProfesseur);
router.patch('/:id/retour', authMiddleware, requireRole('professeur'), c.retourProfesseur);

// Admin (avant /:id)
router.get('/en-attente/count', authMiddleware, requireRole('admin'), c.getNombreEnAttente);
router.get('/', authMiddleware, requireRole('admin'), c.getAllReclamations);
router.get('/:id/professeurs', authMiddleware, requireRole('admin'), c.getProfesseursCandidats);
router.patch('/:id/transferer', authMiddleware, requireRole('admin'), c.transfererReclamation);
router.patch('/:id/repondre', authMiddleware, requireRole('admin'), c.repondreReclamation);
router.patch('/:id/rejeter', authMiddleware, requireRole('admin'), c.rejeterReclamation);

// Tous rôles (l'accès est contrôlé dans le contrôleur)
router.get('/:id', authMiddleware, c.getReclamation);
router.post('/:id/messages', authMiddleware, c.envoyerMessage);
router.post('/:id/pieces', authMiddleware, c.autoriserPiece,
  upload.single('file'), c.verifierPiece, uploadToCloudinary('scolarhub/reclamations'), c.ajouterPiece);

module.exports = router;