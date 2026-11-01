const express = require('express');
const router = express.Router();
const { login, setupPassword, me, modifierProfil, changePassword, register, lookup, forgotPassword, resetPassword, etablissementParCode, filieresPubliques } = require('../controllers/auth.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { identifierParMatricule, espacesParPersonne } = require('../controllers/identification.controller');

router.post('/login',           login);
router.get('/lookup',           lookup);
router.get('/etablissement',    etablissementParCode);
router.get('/filieres',        filieresPubliques);
router.get('/identifier',      identifierParMatricule);
router.get('/espaces',          espacesParPersonne);
router.post('/register',        register);
router.post('/setup-password',  setupPassword);
router.get('/me',               authMiddleware, me);
router.patch('/profil',         authMiddleware, modifierProfil);
router.post('/change-password', authMiddleware, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);

module.exports = router;