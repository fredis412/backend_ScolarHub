const express = require('express');
const router = express.Router();
const etudiantsController = require('../controllers/etudiants.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { upload, uploadToCloudinary } = require('../middleware/upload.middleware');

router.get('/', authMiddleware, etudiantsController.listEtudiants);
router.post('/', authMiddleware, requireRole('admin'), etudiantsController.inscrireEtudiant);
// Route publique — activation du compte lors de la première connexion
router.post('/finaliser', etudiantsController.finaliserPremiereConnexion);

// Matricule automatique, paramètres d'inscription, inscriptions à valider (admin).
// ⚠️ Doivent rester AVANT les routes '/:id/...' pour ne pas être confondues avec un id.
router.get('/prochain-matricule', authMiddleware, requireRole('admin'), etudiantsController.prochainMatricule);
router.get('/parametres-inscription', authMiddleware, requireRole('admin'), etudiantsController.getParametresInscription);
router.put('/parametres-inscription', authMiddleware, requireRole('admin'), etudiantsController.setParametresInscription);
router.get('/en-attente', authMiddleware, requireRole('admin'), etudiantsController.listerEnAttente);
router.post('/valider-inscriptions', authMiddleware, requireRole('admin'), etudiantsController.validerInscriptions);
router.post('/refuser-inscriptions', authMiddleware, requireRole('admin'), etudiantsController.refuserInscriptions);

router.post('/:id/photo', authMiddleware, requireRole('admin'), upload.single('file'), uploadToCloudinary('scolarhub/photos-profil'), etudiantsController.uploaderPhotoEtudiant);
router.post('/:id/document', authMiddleware, requireRole('admin'), upload.single('file'), uploadToCloudinary('scolarhub/documents-etudiants'), etudiantsController.ajouterDocumentEtudiant);
router.get('/:id/documents', authMiddleware, requireRole('admin'), etudiantsController.listerDocumentsEtudiant);
router.put('/:id/identite', authMiddleware, requireRole('admin'), etudiantsController.completerIdentite);

router.get('/delegues', authMiddleware, etudiantsController.getDelegues);
router.get('/stats/inscriptions', authMiddleware, requireRole('admin'), etudiantsController.getStatsInscriptions);
router.post('/:id/nommer-delegue', authMiddleware, etudiantsController.nommerDelegue);
router.patch('/:id/revoquer-delegue', authMiddleware, etudiantsController.revoquerDelegue);
router.get('/bde', authMiddleware, etudiantsController.getBde);
router.post('/:id/nommer-bde', authMiddleware, etudiantsController.nommerBde);
router.patch('/:id/revoquer-bde', authMiddleware, etudiantsController.revoquerBde);

// Modifier la fiche d'un étudiant (⚠️ après les autres PUT, comme /parametres-inscription)
router.put('/:id', authMiddleware, requireRole('admin'), etudiantsController.modifierEtudiant);

module.exports = router;