const express = require('express');
const router = express.Router();
const reportController = require('./reportController');

router.get('/reports/kpi', reportController.kpi);
router.get('/reports/detailed', reportController.detailed);
router.get('/reports/machines', reportController.machines);
router.get('/reports/director', reportController.director);
router.get('/reports/employees', reportController.employees);
router.get('/reports/employees/:worker/tasks', reportController.employeeTasks);


module.exports = router;
