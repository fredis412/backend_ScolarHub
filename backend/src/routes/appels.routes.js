const express = require('express');
const router = express.Router();
const appelsController = require('../controllers/appels.controller');
const qrController = require('../controllers/appels_qr.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

// ── Appel par QR code / code de séance ──
// (déclaré avant /:id pour ne pas être capturé par la route paramétrique)
router.post('/qr', authMiddleware, requireRole('professeur', 'admin'), qrController.ouvrirSessionQr);
router.post('/qr/checkin', authMiddleware, qrController.checkin);
router.get('/qr/:sessionId', authMiddleware, qrController.getSessionQr);
router.post('/qr/:sessionId/cloturer', authMiddleware, requireRole('professeur', 'admin'), qrController.cloturerSessionQr);

// ── Appel classique ──
router.post('/', authMiddleware, appelsController.createAppel);
router.get('/', authMiddleware, appelsController.getAppels);
router.get('/:id', authMiddleware, appelsController.getAppelDetail);

module.exports = router;
