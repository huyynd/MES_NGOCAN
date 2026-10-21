const express = require('express');
const router = express.Router();
const { requirePerm, requireAnyPerm } = require('../../core/requireAuth');
const user = require('./userController');

// Danh sách tài khoản: chỉ màn Tài khoản / Vai trò / Phân quyền dùng — trước đây ai cũng đọc được
const canReadUsers = requireAnyPerm(['sys_users', 'view'], ['md_roles', 'view'], ['sys_permissions', 'view']);

router.get('/users', canReadUsers, user.list);
router.post('/users', requirePerm('sys:users:edit'), user.create);
router.get('/users/:id', canReadUsers, user.getById);
router.put('/users/:id', requirePerm('sys:users:edit'), user.update);
router.delete('/users/:id', requirePerm('sys:users:edit'), user.remove);

module.exports = router;
