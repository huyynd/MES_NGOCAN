const express = require('express');
const router = express.Router();
const { requirePerm, requireAnyPerm } = require('../../core/requireAuth');
const { hideCustomerContact } = require('../../core/lib/visibility');
const { makeCrud } = require('../../core/genericCrud');
const production = require('../production/productionController');
const { WAREHOUSE_DEPENDENTS, LOCATION_DEPENDENTS, EMPLOYEE_DEPENDENTS } = require('../../core/lib/deleteGuard');
const { duplicateNameMessage, isEmail, isTime } = require('../../core/lib/validate');

// F4: kiểm dữ liệu danh mục → 400 tiếng Việt (trước đây thiếu tên / giờ sai → 500).
// Tạo (id = null): tên bắt buộc. Sửa: chỉ kiểm trường có gửi lên.
const requireName = (label) => (b, id) =>
  ((!id || b.name !== undefined) && !String(b.name || '').trim() ? `Vui lòng nhập ${label}.` : null);
// D-04: khu vực của vị trí phải thuộc đúng kho (sửa 1 phần → lấy giá trị cũ cho trường không gửi)
async function zoneInWarehouse(conn, b, id) {
  if (b.zone_id === undefined && b.warehouse_id === undefined) return null;
  const cur = id ? (await conn.query('SELECT warehouse_id, zone_id FROM locations WHERE id = $1', [id])).rows[0] || {} : {};
  const wh = b.warehouse_id !== undefined ? b.warehouse_id : cur.warehouse_id;
  const zone = b.zone_id !== undefined ? b.zone_id : cur.zone_id;
  if (!zone) return null;
  const z = (await conn.query('SELECT warehouse_id FROM zones WHERE id = $1', [zone])).rows[0];
  return !z || String(z.warehouse_id) !== String(wh) ? 'Khu vực không thuộc kho đã chọn.' : null;
}

const validators = {
  customers: async (conn, b, id) => requireName('Tên khách hàng')(b, id)
    || (b.email && !isEmail(b.email) ? 'Email không đúng định dạng.' : null)
    || (b.name !== undefined ? await duplicateNameMessage(conn, { table: 'customers', codeCol: 'customer_code', label: 'Khách hàng' }, b.name, id) : null),
  machines: async (conn, b, id) => requireName('Tên máy')(b, id),
  warehouses: async (conn, b, id) => requireName('Tên kho')(b, id),
  zones: async (conn, b, id) => requireName('Tên khu vực')(b, id),
  locations: async (conn, b, id) => requireName('Tên vị trí')(b, id) || (!id && !b.warehouse_id ? 'Vui lòng chọn Kho.' : null)
    || await zoneInWarehouse(conn, b, id),
  employees: async (conn, b, id) => requireName('Tên nhân viên')(b, id),
  shifts: async (conn, b, id) => requireName('Tên ca')(b, id)
    || (b.start_time && !isTime(b.start_time) ? 'Giờ bắt đầu không hợp lệ (định dạng HH:MM, 00:00–23:59).' : null)
    || (b.end_time && !isTime(b.end_time) ? 'Giờ kết thúc không hợp lệ (định dạng HH:MM, 00:00–23:59).' : null),
};

// ---- Master data ----
// Ghi danh mục kiểm đúng quyền như nút trên web: can('md_<danh mục>', 'create' | 'edit' | 'delete')
// (MasterData.jsx). Trước đây không kiểm → tài khoản nào cũng thêm/sửa/xóa được qua API.
// Đọc: mặc định để mở (dropdown, app mobile cần); riêng khách hàng có cổng đọc riêng (readGuards).
const readGuards = {
  '/customers': [requireAnyPerm(['md_customers', 'view'], ['orders', 'view'], ['deliveries', 'view']), hideCustomerContact],
};
function mountCrud(path, crud) {
  const app = 'md_' + path.slice(1);
  const can = (action) => requireAnyPerm([app, action]);
  const read = readGuards[path] || [];
  router.get(`${path}`, ...read, crud.list);
  router.post(`${path}`, can('create'), crud.create);
  router.post(`${path}/import`, can('create'), crud.bulkCreate);
  router.get(`${path}/:id`, ...read, crud.getById);
  router.put(`${path}/:id`, can('edit'), crud.update);
  router.delete(`${path}/:id`, can('delete'), crud.remove);
}

mountCrud('/customers', makeCrud({
  table: 'customers', validate: validators.customers,
  columns: ['name', 'customer_type', 'phone', 'email', 'address', 'status'],
  searchCols: ['name', 'customer_code', 'phone'], exactCols: ['customer_type', 'status'], codeCol: 'customer_code',
  blockDeleteStatuses: ['Hoạt động'],
}));

mountCrud('/machines', makeCrud({
  table: 'machines', validate: validators.machines,
  columns: ['name', 'factory', 'machine_type', 'status'],
  searchCols: ['name', 'machine_code'], exactCols: ['factory', 'status'], codeCol: 'machine_code',
  blockDeleteStatuses: ['Hoạt động', 'Bảo trì'],
  extraSelect: `,
    CASE WHEN EXISTS (
      SELECT 1 FROM production_tasks pt JOIN production_orders po ON po.id = pt.production_order_id
      WHERE po.is_deleted = FALSE AND pt.machine_id = machines.id AND pt.status = 'Đang sản xuất')
    OR EXISTS (
      SELECT 1 FROM production_orders po
      WHERE po.is_deleted = FALSE AND po.machine_id = machines.id AND po.status = 'Đang sản xuất')
    THEN 'Đang sản xuất' ELSE 'Chờ sản xuất' END AS production_status`,
}));
router.get('/machines/:id/orders', production.byMachine);

mountCrud('/warehouses', makeCrud({
  table: 'warehouses', validate: validators.warehouses,
  columns: [
    'name', 'warehouse_type', 'status', 'purpose', 'factory', 'workshop',
    'address', 'manager', 'department', 'phone', 'description',
    'allow_inbound', 'allow_outbound', 'allow_transfer', 'allow_manufacturing',
    'require_qc', 'require_approval', 'outbound_method',
    'capacity_unit', 'max_capacity', 'capacity_warning'
  ],
  searchCols: ['name', 'warehouse_code'], exactCols: ['warehouse_type', 'status'], codeCol: 'warehouse_code',
  blockDeleteStatuses: ['Hoạt động', 'Đang kiểm đếm'],
  deleteDependents: WAREHOUSE_DEPENDENTS,
}));

mountCrud('/zones', makeCrud({
  table: 'zones', validate: validators.zones,
  columns: ['warehouse_id', 'name', 'description', 'status'],
  searchCols: ['name', 'zone_code'], exactCols: ['warehouse_id', 'status'], codeCol: 'zone_code',
  blockDeleteStatuses: ['Hoạt động'],
}));

mountCrud('/locations', makeCrud({
  table: 'locations', validate: validators.locations,
  columns: ['warehouse_id', 'zone_id', 'name'],
  searchCols: ['name', 'location_code'], exactCols: ['warehouse_id', 'zone_id'], codeCol: 'location_code',
  deleteDependents: LOCATION_DEPENDENTS,
}));

mountCrud('/shifts', makeCrud({
  table: 'shifts', validate: validators.shifts,
  columns: ['name', 'start_time', 'end_time', 'status'],
  searchCols: ['name', 'shift_code'], exactCols: ['status'], orderBy: 'shift_code', codeCol: 'shift_code',
  blockDeleteStatuses: ['Hoạt động'],
}));

mountCrud('/employees', makeCrud({
  table: 'employees', validate: validators.employees,
  columns: ['name', 'factory', 'position', 'skill_level', 'phone', 'status'],
  searchCols: ['name', 'employee_code', 'phone'], exactCols: ['factory', 'status'], codeCol: 'employee_code',
  blockDeleteStatuses: ['Hoạt động'],
  blockDeleteMessage: 'Không thể xóa nhân viên đang "Hoạt động" - họ có thể đang được phân công ở công việc khác. Vui lòng chuyển trạng thái sang "Không hoạt động" (hoặc "Đã nghỉ") trước, rồi mới xóa.',
  deleteDependents: EMPLOYEE_DEPENDENTS,
}));

module.exports = router;
