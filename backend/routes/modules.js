const express = require('express');
const router = express.Router();
const moduleController = require('../controllers/moduleController');

router.get('/', moduleController.getAllModules);
router.post('/', moduleController.createModule);
router.put('/:id', moduleController.updateModule);
router.post('/assign-prof', moduleController.assignProfessor);

module.exports = router;
