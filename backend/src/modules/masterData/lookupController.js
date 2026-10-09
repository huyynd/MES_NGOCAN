// backend/controllers/lookupController.js — dữ liệu cho dropdown ở frontend
const db = require('../../core/db');

// Xem trước mã kế tiếp sẽ được cấp (MAX hiện có + 1) — chỉ để hiển thị ở form
const CODE_MAP = {
  products: ['products', 'product_code', 'SP', 5],
  customers: ['customers', 'customer_code', 'KH', 5],
  machines: ['machines', 'machine_code', 'MC', 4],
  warehouses: ['warehouses', 'warehouse_code', 'K', 3],
  zones: ['zones', 'zone_code', 'KV', 3],
  locations: ['locations', 'location_code', 'VT', 4],
  shifts: ['shifts', 'shift_code', 'CA', 2],
  employees: ['employees', 'employee_code', 'NV', 5],
  roles: ['roles', 'role_code', 'VT', 3],
  boms: ['boms', 'bom_code', 'BOM', 5],
  processes: ['tech_processes', 'process_code', 'QT', 4],
  salesOrders: ['sales_orders', 'order_code', 'DH', 5],
  productionOrders: ['production_orders', 'order_code', 'LSX', 5],
};

exports.nextCode = async (req, res) => {
  try {
    const cfg = CODE_MAP[req.params.entity];
    if (!cfg) return res.status(400).json({ message: 'Entity không hợp lệ' });
    const [table, col, prefix, width] = cfg;
    // Chỉ đếm mã đúng mẫu <tiền tố><số> (bỏ qua mã lạ/mã test); bigint để không tràn — khớp trigger gen_code_trg
    const { rows } = await db.query(
      `SELECT COALESCE(MAX(substr(${col}, length($1) + 1)::bigint), 0) + 1 AS n FROM ${table}
       WHERE left(${col}, length($1)) = $1 AND substr(${col}, length($1) + 1) ~ '^[0-9]{1,18}$'`, [prefix]);
    res.json({ code: prefix + String(rows[0].n).padStart(width, '0') });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy mã kế tiếp' }); }
};

exports.all = async (_req, res) => {
  try {
    const [products, customers, machines, warehouses, zones, locations, employees, shiftRows] = await Promise.all([
      db.query(`SELECT id, product_code, product_name, product_type, product_types, unit FROM products WHERE is_deleted = FALSE ORDER BY product_code`),
      db.query(`SELECT id, customer_code, name FROM customers WHERE is_deleted = FALSE ORDER BY name`),
      db.query(`SELECT id, machine_code, name, factory, machine_type, status,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM production_tasks pt JOIN production_orders po ON po.id = pt.production_order_id
                    WHERE po.is_deleted = FALSE AND pt.machine_id = machines.id AND pt.status = 'Đang sản xuất')
                  OR EXISTS (
                    SELECT 1 FROM production_orders po
                    WHERE po.is_deleted = FALSE AND po.machine_id = machines.id AND po.status = 'Đang sản xuất')
                  THEN 'Đang sản xuất' ELSE 'Chờ sản xuất' END AS production_status
                FROM machines WHERE is_deleted = FALSE ORDER BY factory, name`),
      db.query(`SELECT id, warehouse_code, name, warehouse_type FROM warehouses WHERE is_deleted = FALSE ORDER BY name`),
      db.query(`SELECT id, warehouse_id, zone_code, name FROM zones WHERE is_deleted = FALSE ORDER BY name`),
      db.query(`SELECT l.id, l.location_code, l.name, l.warehouse_id, w.name AS warehouse_name, l.zone_id, z.name AS zone_name
                FROM locations l 
                JOIN warehouses w ON w.id = l.warehouse_id 
                LEFT JOIN zones z ON z.id = l.zone_id
                WHERE l.is_deleted = FALSE ORDER BY w.name, z.name, l.name`),
      db.query(`SELECT id, employee_code, name, factory, position, skill_level FROM employees WHERE is_deleted = FALSE ORDER BY factory, name`),
      db.query(`SELECT id, name FROM shifts WHERE is_deleted = FALSE ORDER BY shift_code`),
    ]);
    // Giá trị thuộc tính cốt lõi đã dùng (gợi ý nhập nhanh)
    const attrs = await db.query(`
      SELECT DISTINCT a->>'name' AS name, a->>'value' AS value
      FROM products p, jsonb_array_elements(p.attributes) a
      WHERE p.is_deleted = FALSE AND a->>'value' <> ''`);
    const byName = (n) => attrs.rows.filter(r => r.name === n).map(r => r.value);

    // Mã cuộn mặc định (app_settings.roll_product_id) — để màn Lệnh SX điền sẵn "Sản phẩm đầu ra"
    // của dòng Thổi ngay cả khi tạo lệnh mới (trước đây chỉ có ở getById của lệnh đã lưu).
    // + NVL mặc định (app_settings.default_material_product_id) — dòng đầu bảng NVL ở Đơn hàng / LSX.
    const settings = (await db.query(
      `SELECT key, value FROM app_settings WHERE key IN ('roll_product_id', 'default_material_product_id')`)).rows;
    const setting = (k) => { const v = settings.find((s) => s.key === k)?.value; return v == null ? null : String(v); };

    res.json({
      products: products.rows,
      customers: customers.rows,
      machines: machines.rows,
      warehouses: warehouses.rows,
      zones: zones.rows,
      locations: locations.rows,
      employees: employees.rows,
      shiftList: shiftRows.rows, // [{id, name}] cho lịch làm việc
      units: ['cái', 'cuộn', 'kg', 'bao', 'thùng', 'm'],
      shifts: shiftRows.rows.length ? shiftRows.rows.map((s) => s.name) : ['Ca 1', 'Ca 2', 'Ca 3'],
      colors: byName('Màu sắc'),
      sizes: byName('Kích thước'),
      thicknesses: byName('Độ dày'),
      finishingOptions: ['Đục lỗ', 'Xí đáy', 'In ấn', 'Ghép màng', 'Hàn đáy', 'Bo góc'],
      default_roll_product_id: setting('roll_product_id'),
      default_material_product_id: setting('default_material_product_id'),
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy dữ liệu lookup' }); }
};
