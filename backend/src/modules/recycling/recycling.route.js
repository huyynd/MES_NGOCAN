const express = require('express');
const router = express.Router();
const { requirePerm } = require('../../core/requireAuth');
const recycling = require('./recyclingController');
const { uuidParam } = require('../../core/lib/validate');
// :id không phải UUID → 404 trước khi chạm CSDL
router.param('id', uuidParam('Không tìm thấy phiếu tái chế'));

// Using production:edit permission for recycling operations
router.get('/recycling', recycling.list);
router.get('/recycling/:id', recycling.getById);
router.post('/recycling', requirePerm('production:edit'), recycling.create);
router.put('/recycling/:id/weigh', requirePerm('production:edit'), recycling.weigh);
router.put('/recycling/:id/receive', requirePerm('production:edit'), recycling.receiveRolls);
router.put('/recycling/:id/complete', requirePerm('production:edit'), recycling.complete);

module.exports = router;
