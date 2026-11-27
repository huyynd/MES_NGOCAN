const express = require('express');
const router = express.Router();
const { requirePerm, requireAnyPerm } = require('../../core/requireAuth');
const user = require('./userController');
const { uuidParam } = require('../../core/lib/validate');
// :id không phải UUID → 404 trước khi chạm CSDL
router.param('id', uuidParam('Không tìm thấy tài khoản'));

// Danh sách tài khoản: chỉ màn Tài khoản / Vai trò / Phân quyền dùng — trước đây ai cũng đọc được
const canReadUsers = requireAnyPerm(['sys_users', 'view'], ['md_roles', 'view'], ['sys_permissions', 'view']);

router.get('/users', canReadUsers, user.list);
router.post('/users', requirePerm('sys:users:edit'), user.create);
router.get('/users/:id', canReadUsers, user.getById);
router.put('/users/:id', requirePerm('sys:users:edit'), user.update);
router.delete('/users/:id', requirePerm('sys:users:edit'), user.remove);

module.exports = router;
