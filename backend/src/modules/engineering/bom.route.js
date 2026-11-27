const express = require('express');
const router = express.Router();
const { requirePerm } = require('../../core/requireAuth');
const bom = require('./bomController');
const { uuidParam } = require('../../core/lib/validate');
// :id không phải UUID → 404 trước khi chạm CSDL
router.param('id', uuidParam('Không tìm thấy định mức'));

router.get('/boms', bom.list);
router.post('/boms', requirePerm('bom:create'), bom.create);
router.get('/boms/:id', bom.getById);
router.put('/boms/:id', requirePerm('bom:edit'), bom.update);
router.delete('/boms/:id', requirePerm('bom:delete'), bom.remove);

module.exports = router;
