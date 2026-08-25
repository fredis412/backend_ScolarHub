const express = require('express');
const router = express.Router();
const statistiqueController = require('../controllers/statistiqueController');

router.get('/filieres', statistiqueController.getFiliereStats);

module.exports = router;
