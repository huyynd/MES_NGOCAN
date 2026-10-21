const express = require('express');
const router = express.Router();
const { requirePerm, requireAnyPerm } = require('../../core/requireAuth');
const role = require('./roleController');
const { makeCrud } = require('../../core/genericCrud');

// Vai trò: trước đây ai cũng thêm/sửa/xóa được — kể cả đổi parent_id để vai trò của mình KẾ THỪA quyền
// vai trò khác (tự nâng quyền). Giờ ghi cần quyền md_roles tương ứng (menu "Vai trò");
// đọc cần quyền xem Vai trò / Phân quyền / Tài khoản (màn Tài khoản cần danh sách vai trò).
const canReadRoles = requireAnyPerm(['md_roles', 'view'], ['sys_permissions', 'view'], ['sys_users', 'view']);

function mountCrud(path, crud) {
  const can = (action) => requireAnyPerm(['md_roles', action]);
  router.get(`${path}`, canReadRoles, crud.list);
  router.post(`${path}`, can('create'), crud.create);
  router.post(`${path}/import`, can('create'), crud.bulkCreate);
  router.get(`${path}/:id`, canReadRoles, crud.getById);
  router.put(`${path}/:id`, can('edit'), crud.update);
  router.delete(`${path}/:id`, can('delete'), crud.remove);
}

mountCrud('/roles', makeCrud({
  table: 'roles',
  columns: ['name', 'description', 'status', 'parent_id'],
  searchCols: ['name', 'role_code'], exactCols: ['status'], codeCol: 'role_code',
  blockDeleteStatuses: ['Hoạt động'],
}));
router.put('/roles/:id/permissions', requirePerm('sys:roles:edit'), role.savePermissions);
// Quyền hiệu lực: người quản lý vai trò, hoặc chính vai trò của mình
router.get('/roles/:id/effective-permissions', (req, res, next) =>
  (req.user && String(req.user.role_id) === String(req.params.id) ? next() : canReadRoles(req, res, next)),
role.getEffectivePermissions);

module.exports = router;
