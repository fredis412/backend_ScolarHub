// ============================================================
// src/routes/messageRoutes.js
// ZOUNGRANA Jalil — Routes API Messagerie
// ============================================================

const express = require('express');
const router  = express.Router();
const { authMiddleware: auth } = require('../middleware/auth.middleware');  // ← corrigé
const {
  getCanaux,
  getMessagesCanal,
  envoyerMessageCanal,
  getConversationsPrivees,
  getMessagesPrives,
  envoyerMessagePrive,
  marquerMessagesPrivesLus,
  ajouterMembreCanal,
  getMessagesGroupe,
  envoyerMessageGroupe,
  getMembresGroupe,
  marquerGroupeLu,
  getNombreNonLusGroupe,
  marquerMessageLu,
  getLecteursMessage,
  getProfFilieres,
  ajouterReaction,
  masquerMessage,
  epinglerMessage,
  supprimerMessage,
  supprimerMessageType,
  getAdminContact,
  getAdminContacts,
  getContacts,
  getUsersOnline,
  getCanauxStandard,
} = require('../controllers/messageController');

// Toutes les routes messagerie nécessitent un JWT valide
router.use(auth);

// ── Canaux ────────────────────────────────────────────────
router.get('/canaux',            getCanaux);
router.get('/canaux-standard',   getCanauxStandard);
router.get('/canal/:id',         getMessagesCanal);
router.post('/canal/:id',        envoyerMessageCanal);

// ── Messages privés ───────────────────────────────────────
router.get('/prives',            getConversationsPrivees);
router.get('/prives/:userId',    getMessagesPrives);
router.post('/prives/:userId',   envoyerMessagePrive);
router.post('/prives/read/:userId', marquerMessagesPrivesLus);

// ── Gestion des membres de canaux ─────────────────────────
router.post('/canaux/:id/membres', ajouterMembreCanal);

// ── Groupe filière ───────────────────────────────────────
router.get('/groupe/mes-filieres', getProfFilieres);  // lister filières du prof
router.get('/groupe/:filiereId',   getMessagesGroupe);
router.post('/groupe/:filiereId',  envoyerMessageGroupe);

// Membres réels + suivi de lecture (badge non-lu de "Ma filière")
router.get('/groupe/:filiereId/membres',           getMembresGroupe);
router.patch('/groupe/:filiereId/lu',               marquerGroupeLu);
router.get('/groupe/:filiereId/non-lus/count',      getNombreNonLusGroupe);

// "Vu par" — n'importe quel message (canal, groupe filière, ou privé)
router.post('/:type/:id/lu',       marquerMessageLu);
router.get('/:type/:id/lecteurs',  getLecteursMessage);

// ── Réactions, masquage ("supprimer pour moi") & suppression ─────────────
router.post('/:id/reaction',      ajouterReaction);
router.post('/:type/:id/masquer', masquerMessage);
router.patch('/:type/:id/epingle', epinglerMessage);   // épingler / désépingler (canal, groupe, privé)
router.delete('/:id',             supprimerMessage);       // ancienne route (canaux uniquement, conservée pour compatibilité)
router.delete('/:type/:id',       supprimerMessageType);    // "supprimer pour tout le monde" — canal/groupe/prive

// ── Présence & contacts ───────────────────────────────────
router.get('/online',            getUsersOnline);
router.get('/admin-contact',     getAdminContact);
router.get('/admin-contacts',    getAdminContacts);
router.get('/contacts',          getContacts);

module.exports = router;