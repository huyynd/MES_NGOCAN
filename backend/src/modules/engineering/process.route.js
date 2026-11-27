const express = require('express');
const router = express.Router();
const { requirePerm } = require('../../core/requireAuth');
const techProcess = require('./processController');
const { uuidParam } = require('../../core/lib/validate');
// :id không phải UUID → 404 trước khi chạm CSDL
router.param('id', uuidParam('Không tìm thấy quy trình'));

router.get('/processes', techProcess.list);
router.post('/processes', requirePerm('process:create'), techProcess.create);
router.get('/processes/:id', techProcess.getById);
router.put('/processes/:id', requirePerm('process:edit'), techProcess.update);
router.delete('/processes/:id', requirePerm('process:delete'), techProcess.remove);

module.exports = router;
