const express = require('express');
const router = express.Router();
const { requireAnyPerm } = require('../../core/requireAuth');
const reportController = require('./reportController');

router.get('/reports/kpi', reportController.kpi);
router.get('/reports/detailed', reportController.detailed);
router.get('/reports/machines', reportController.machines);
// Báo cáo giám đốc: chỉ ai được cấp menu "Báo cáo giám đốc" (rep_director) — trước đây ai cũng gọi được
router.get('/reports/director', requireAnyPerm(['rep_director', 'view']), reportController.director);
// Báo cáo sản lượng: kế hoạch chuyển kỳ (chốt 2026-11-13)
router.get('/reports/output', requireAnyPerm(['prod_output', 'view'], ['production', 'view']), reportController.output);
router.get('/reports/employees', reportController.employees);
router.get('/reports/employees/:worker/tasks', reportController.employeeTasks);


module.exports = router;
