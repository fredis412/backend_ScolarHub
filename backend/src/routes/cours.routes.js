const express = require('express');
const router = express.Router();
const coursController = require('../controllers/cours.controller');
const { authMiddleware } = require('../middleware/auth.middleware');
const { upload, uploadToCloudinary } = require('../middleware/upload.middleware');

router.post('/', authMiddleware, upload.single('file'), coursController.uploadCours);
router.get('/', authMiddleware, coursController.getCours);
router.get('/:id/download', coursController.downloadCours);

module.exports = router;
