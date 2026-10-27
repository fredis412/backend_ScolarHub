const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const gifsController = require('../controllers/gifs.controller');

router.get('/search', authMiddleware, gifsController.rechercherGifs);

module.exports = router;
