const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const parentsController = require('../controllers/parents.controller');

// ── Admin ──────────────────────────────────────────────────────────────────
// Liste des parents liés + étudiants en attente de rattachement
router.get('/', authMiddleware, requireRole('admin', 'direction'), parentsController.getParents);
// Créer/lier un tuteur à un étudiant (voir écran admin dédié de rattachement)
router.post('/', authMiddleware, requireRole('admin', 'direction'), parentsController.createParent);
// Retirer un lien tuteur↔enfant (ne supprime pas le compte parent lui-même)
router.delete('/lien/:etudiantId', authMiddleware, requireRole('admin', 'direction'), parentsController.supprimerLien);
// Fiche parent : modifier, réinitialiser l'accès, activer/désactiver le compte
router.put('/:id', authMiddleware, requireRole('admin', 'direction'), parentsController.modifierParent);
router.post('/:id/reinitialiser', authMiddleware, requireRole('admin', 'direction'), parentsController.reinitialiserAcces);
router.patch('/:id/statut', authMiddleware, requireRole('admin', 'direction'), parentsController.changerStatutParent);

// ── Public : première connexion parent ──────────────────────────────────────
// Appelée après que /api/auth/login a renvoyé { premiereFois: true, parent }
router.post('/finaliser', parentsController.finaliserPremiereConnexion);

// ── Parent connecté ────────────────────────────────────────────────────────
router.get('/mes-enfants', authMiddleware, parentsController.getMesEnfants);
router.post('/consultation', authMiddleware, parentsController.marquerConsulte);
router.get('/enfant/:etudiantId/notes', authMiddleware, parentsController.getNotesEnfant);
router.get('/enfant/:etudiantId/bulletins', authMiddleware, parentsController.getBulletinsEnfant);
router.get('/enfant/:etudiantId/presences', authMiddleware, parentsController.getPresencesEnfant);
router.get('/enfant/:etudiantId/programme', authMiddleware, parentsController.getProgrammeEnfant);
router.get('/enfant/:etudiantId/contact-administration', authMiddleware, parentsController.getContactAdministration);
router.get('/mon-profil', authMiddleware, parentsController.getMonProfil);
// ── Admin : édition des champs d'affichage tuteur sur `etudiants` ───────────
router.get('/enfant/:etudiantId', authMiddleware, requireRole('admin', 'direction'), parentsController.getInfoTuteur);
router.put('/enfant/:etudiantId', authMiddleware, requireRole('admin', 'direction'), parentsController.modifierInfoTuteur);

module.exports = router;