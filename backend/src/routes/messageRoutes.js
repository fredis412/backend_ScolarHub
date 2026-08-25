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
  getMessagesGroupe,
  envoyerMessageGroupe,
  ajouterReaction,
  supprimerMessage,
  getAdminContact,
  getUsersOnline,
} = require('../controllers/messageController');

// Toutes les routes messagerie nécessitent un JWT valide
router.use(auth);

// ── Canaux ────────────────────────────────────────────────
router.get('/canaux',            getCanaux);
router.get('/canal/:id',         getMessagesCanal);
router.post('/canal/:id',        envoyerMessageCanal);

// ── Messages privés ───────────────────────────────────────
router.get('/prives',            getConversationsPrivees);
router.get('/prives/:userId',    getMessagesPrives);
router.post('/prives/:userId',   envoyerMessagePrive);

// ── Groupe filière ────────────────────────────────────────
router.get('/groupe/:filiereId', getMessagesGroupe);
router.post('/groupe/:filiereId',envoyerMessageGroupe);

// ── Réactions & suppression ───────────────────────────────
router.post('/:id/reaction',     ajouterReaction);
router.delete('/:id',            supprimerMessage);

// ── Présence & contacts ───────────────────────────────────
router.get('/online',            getUsersOnline);
router.get('/admin-contact',     getAdminContact);

module.exports = router;
