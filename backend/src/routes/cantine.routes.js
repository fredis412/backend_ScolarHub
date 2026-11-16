const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { upload, uploadToCloudinary } = require('../middleware/upload.middleware');
const cantineController = require('../controllers/cantine.controller');

// Lecture du menu publié du jour — accessible à tout rôle connecté
// (étudiant, parent, prof, admin). Renvoie aussi les horaires et le lieu.
router.get('/aujourdhui', authMiddleware, cantineController.getMenuAujourdhui);

// Écran d'édition (admin / cantinière) : voir et publier un menu.
router.get('/jour', authMiddleware, requireRole('admin'), cantineController.getMenuJour);
router.post('/publier', authMiddleware, requireRole('admin'), cantineController.publierMenu);
router.post('/copier', authMiddleware, requireRole('admin'), cantineController.copierMenu);

// Plats du menu : photo, ajout, modification, suppression.
router.post('/plats/image', authMiddleware, requireRole('admin'), upload.single('file'), uploadToCloudinary('scolarhub/cantine'), cantineController.televerserImagePlat);
router.post('/plats', authMiddleware, requireRole('admin'), cantineController.creerPlat);
router.put('/plats/:id', authMiddleware, requireRole('admin'), cantineController.modifierPlat);
router.delete('/plats/:id', authMiddleware, requireRole('admin'), cantineController.supprimerPlat);

// Horaires d'ouverture et lieu de la cantine.
router.put('/parametres', authMiddleware, requireRole('admin'), cantineController.enregistrerParametres);

// Commandes : l'étudiant commande et suit ses tickets ; l'admin les voit et les traite.
router.post('/commandes', authMiddleware, cantineController.passerCommande);
router.get('/mes-commandes', authMiddleware, cantineController.getMesCommandes);
router.patch('/commandes/:id/annuler', authMiddleware, cantineController.annulerCommande);
router.get('/commandes', authMiddleware, requireRole('admin'), cantineController.getCommandes);
router.patch('/commandes/:id/traiter', authMiddleware, requireRole('admin'), cantineController.traiterCommande);

module.exports = router;