const express = require('express');
const router = express.Router();
const { requirePerm } = require('../../core/requireAuth');
const production = require('./productionController');
const { uuidParam } = require('../../core/lib/validate');

// Mọi route :id / :taskId của router này: không phải UUID → 404 trước khi chạm CSDL (cùng câu notUuid trong controller)
router.param('id', uuidParam('Không tìm thấy lệnh sản xuất'));
router.param('taskId', uuidParam('Không tìm thấy dòng phân công'));

router.get('/production-orders', production.list);
router.post('/production-orders', requirePerm('production:create'), production.create);
// Kiểm trần NVL trước khi lưu (chỉ đọc): lệnh mới cần quyền tạo, lệnh đang sửa cần quyền sửa — như route tạo / sửa lệnh
router.post('/production-orders/check-material-cap',
  (req, res, next) => requirePerm(req.body && req.body.id ? 'production:edit' : 'production:create')(req, res, next),
  production.checkMaterialCap);
router.get('/production-orders/:id', production.getById);
router.put('/production-orders/:id', requirePerm('production:edit'), production.update);
router.put('/production-orders/:id/schedule', requirePerm('production:edit'), production.schedule);
router.put('/production-orders/:id/reschedule', requirePerm('production:edit'), production.reschedule);
router.get('/production/gantt', production.gantt);
router.get('/production/machine-availability', production.machineAvailability);
router.get('/production/execution', production.executionTasks);
router.get('/production/task-by-code/:code', production.getTaskByCode);
router.put('/production/tasks/:taskId', requirePerm('production:edit'), production.updateTask);
router.post('/production/tasks/:taskId/reopen', production.reopenTask);
router.get('/production-orders/:id/tasks', production.getTasks);
router.get('/production-orders/:id/roll-availability', production.rollAvailability);
router.put('/production-orders/:id/tasks', requirePerm('production:edit'), production.saveTasks);
router.post('/production-orders/:id/complete-tasks', requirePerm('production:edit'), production.completeTasks);
router.get('/production-orders/:id/materials', production.getMaterials);
router.post('/production-orders/:id/materials', requirePerm('production:edit'), production.saveMaterials);
// NVL cần cung cấp (kế hoạch cấp NVL) + Yêu cầu NVL → xuất kho
router.get('/production-orders/:id/planned-materials', production.getPlannedMaterials);
router.post('/production-orders/:id/planned-materials', requirePerm('production:edit'), production.savePlannedMaterials);
router.get('/production-orders/:id/material-returns', production.materialReturns);
router.post('/production-orders/:id/material-returns', requirePerm('production:edit'), production.createMaterialReturn);
router.post('/production-orders/:id/finish', requirePerm('production:edit'), production.finish);
router.post('/production-orders/:id/request-materials', requirePerm('production:request'), production.requestMaterials);
router.delete('/production-orders/:id', requirePerm('production:delete'), production.remove);

const scrap = require('./scrapController');

router.get('/scrap/workers', scrap.getWorkers);
router.get('/scrap/daily-wos', scrap.getDailyWos);
router.get('/scrap/records', scrap.getRecords);
router.get('/scrap/all-records', scrap.getAllRecords);
router.post('/scrap/records', requirePerm('production:edit'), scrap.saveRecords);
router.get('/scrap/statistics', scrap.getStats);
router.get('/scrap/summary', scrap.getSummary);
router.get('/scrap/daily-details', scrap.getDailyDetails);

module.exports = router;
