// backend/controllers/productController.js
const db = require('../../core/db');
const { upUnit } = require('../../core/lib/units');
const { guardDelete, PRODUCT_DEPENDENTS } = require('../../core/lib/deleteGuard');
const { duplicateNameMessage } = require('../../core/lib/validate');
// F4: không cho 2 sản phẩm (chưa xóa) trùng tên
const PRODUCT_NAME = { table: 'products', nameCol: 'product_name', codeCol: 'product_code', label: 'Sản phẩm' };

// Loại sản phẩm — cho phép chọn nhiều (tên đầy đủ)
const VALID_TYPES = ['Thành phẩm', 'Bán thành phẩm', 'Nguyên vật liệu'];
// Chuẩn hoá danh sách loại từ body: trả { types: [...], primary }
function normalizeTypes(b) {
  let types = Array.isArray(b.product_types) ? b.product_types.filter((t) => VALID_TYPES.includes(t)) : [];
  if (!types.length && b.product_type && VALID_TYPES.includes(b.product_type)) types = [b.product_type];
  types = [...new Set(types)];
  return { types, primary: types[0] || null };
}

/**
 * GET /api/products/:id/related — dữ liệu liên quan (chỉ xem):
 * đơn hàng & lệnh sản xuất có chứa sản phẩm này.
 */
exports.related = async (req, res) => {
  try {
    const id = req.params.id;
    const sales = await db.query(`
      SELECT so.id, so.order_code, so.order_date, so.status, c.name AS customer_name,
             SUM(it.quantity) AS quantity, MAX(it.unit) AS unit
      FROM sales_order_items it
      JOIN sales_orders so ON so.id = it.sales_order_id AND so.is_deleted = FALSE
      LEFT JOIN customers c ON c.id = so.customer_id
      WHERE it.product_id = $1
      GROUP BY so.id, c.name
      ORDER BY so.created_at DESC`, [id]);
    const prod = await db.query(`
      SELECT po.id, po.order_code, po.quantity, po.unit, po.status, po.planned_date,
             c.name AS customer_name, m.name AS machine_name
      FROM production_orders po
      LEFT JOIN customers c ON c.id = po.customer_id
      LEFT JOIN machines m ON m.id = po.machine_id
      WHERE po.product_id = $1 AND po.is_deleted = FALSE
      ORDER BY po.created_at DESC`, [id]);
    res.json({ salesOrders: sales.rows, productionOrders: prod.rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy dữ liệu liên quan sản phẩm' }); }
};

/**
 * GET /api/products
 * Filter: code, name, type, area  | Pagination: page, pageSize
 */
exports.getProducts = async (req, res) => {
  try {
    const { code, name, type, area } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 10, 1), 100);
    const offset = (page - 1) * pageSize;

    const where = ['is_deleted = FALSE'];
    const params = [];
    let i = 1;

    if (code) { where.push(`product_code ILIKE $${i++}`); params.push(`%${code}%`); }
    if (name) { where.push(`product_name ILIKE $${i++}`); params.push(`%${name}%`); }
    if (type) { where.push(`product_type = $${i++}`); params.push(type); }
    if (area) { where.push(`production_area = $${i++}`); params.push(area); }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const totalRes = await db.query(`SELECT COUNT(*)::int AS total FROM products ${whereSql}`, params);
    const total = totalRes.rows[0].total;

    const dataRes = await db.query(
      `SELECT id, product_code, product_name, product_type, product_types, status, description, attributes, updated_at
       FROM products ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, pageSize, offset]
    );

    res.json({
      data: dataRes.rows,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách sản phẩm' });
  }
};

/**
 * POST /api/products  — lưu attributes (mảng) vào cột JSONB
 */
exports.createProduct = async (req, res) => {
  try {
    const {
      product_name, production_area, category, product_group,
      unit, barcode_type, tracking_type, is_pqc_required, status,
      description, attributes, min_quantity, warehouse_limits,
    } = req.body;

    const { types, primary } = normalizeTypes(req.body);
    if (!String(product_name || '').trim() || !primary) {
      return res.status(400).json({ message: 'Thiếu Tên sản phẩm hoặc Loại sản phẩm' });
    }
    const dup = await duplicateNameMessage(db, PRODUCT_NAME, product_name);
    if (dup) return res.status(400).json({ message: dup });

    // Chuẩn hoá attributes: chỉ giữ dòng có name & value
    const attrs = Array.isArray(attributes)
      ? attributes.filter(a => a && a.name && a.value).map(a => ({ name: a.name, value: a.value }))
      : [];

    const whLimits = Array.isArray(warehouse_limits)
      ? warehouse_limits.filter(w => w && w.warehouse_id && (w.min_quantity != null || w.max_quantity != null))
      : [];

    const result = await db.query(
      `INSERT INTO products
         (product_name, production_area, category, product_type, product_types, product_group,
          unit, barcode_type, tracking_type, is_pqc_required, status, description, attributes, min_quantity, warehouse_limits)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb)
       RETURNING *`,
      [
        product_name, production_area || null, category || null, primary, JSON.stringify(types), product_group || null,
        upUnit(unit), barcode_type || null, tracking_type || null,
        is_pqc_required ?? false, status || 'Hoạt động', description || null,
        JSON.stringify(attrs), min_quantity || null, JSON.stringify(whLimits),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi tạo sản phẩm' });
  }
};

/**
 * PUT /api/products/:id — cập nhật sản phẩm (kèm attributes JSONB)
 */
exports.updateProduct = async (req, res) => {
  try {
    const {
      product_name, production_area, category, product_group,
      unit, barcode_type, tracking_type, is_pqc_required, status,
      description, attributes, min_quantity, warehouse_limits,
    } = req.body;

    const { types, primary } = normalizeTypes(req.body);
    if (!String(product_name || '').trim() || !primary) {
      return res.status(400).json({ message: 'Thiếu Tên sản phẩm hoặc Loại sản phẩm' });
    }
    const dup = await duplicateNameMessage(db, PRODUCT_NAME, product_name, req.params.id);
    if (dup) return res.status(400).json({ message: dup });
    const attrs = Array.isArray(attributes)
      ? attributes.filter(a => a && a.name && a.value).map(a => ({ name: a.name, value: a.value }))
      : [];

    const whLimits = Array.isArray(warehouse_limits)
      ? warehouse_limits.filter(w => w && w.warehouse_id && (w.min_quantity != null || w.max_quantity != null))
      : [];

    const result = await db.query(
      `UPDATE products SET
         product_name=$1, production_area=$2, category=$3, product_type=$4, product_types=$5::jsonb, product_group=$6,
         unit=$7, barcode_type=$8, tracking_type=$9, is_pqc_required=$10, status=$11,
         description=$12, attributes=$13::jsonb, min_quantity=$14, warehouse_limits=$15::jsonb
       WHERE id=$16 AND is_deleted=FALSE
       RETURNING *`,
      [
        product_name, production_area || null, category || null, primary, JSON.stringify(types), product_group || null,
        upUnit(unit), barcode_type || null, tracking_type || null,
        is_pqc_required ?? false, status || 'Hoạt động', description || null,
        JSON.stringify(attrs), min_quantity || null, JSON.stringify(whLimits), req.params.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi cập nhật sản phẩm' });
  }
};

/**
 * GET /api/products/:id — chi tiết + mock data cho tab BOM & Tồn kho
 */
exports.getProductById = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM products WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });

    const product = rows[0];

    // ---- MOCK DATA (Tab Thông tin sản xuất & Tồn kho) ----
    const boms = [
      { bom_code: 'BOM001', product: 'Hạt nhựa HDPE', quantity: 0.85, unit: 'kg', bom_type: 'Định mức chính' },
      { bom_code: 'BOM002', product: 'Mực in', quantity: 0.02, unit: 'kg', bom_type: 'Phụ liệu' },
    ];
    const processes = [
      { step: 1, name: 'Thổi màng', workshop: 'Xưởng thổi' },
      { step: 2, name: 'Cắt & dán', workshop: 'Xưởng cắt' },
    ];
    const inventory = [
      { warehouse: 'Kho TP', current_qty: 1200, expected_qty: 1500, unit: product.unit || 'cái' },
      { warehouse: 'Kho phụ', current_qty: 300, expected_qty: 300, unit: product.unit || 'cái' },
    ];

    res.json({ ...product, boms, processes, inventory });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy chi tiết sản phẩm' });
  }
};

/**
 * POST /api/products/import — nhập hàng loạt, CHẶN TRÙNG mã SP & tên SP
 */
exports.bulkImport = async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ message: 'Không có dòng nào để nhập' });

    const ex = await db.query(`SELECT product_code, lower(product_name) AS lname FROM products WHERE is_deleted = FALSE`);
    const existCodes = new Set(ex.rows.map((r) => String(r.product_code || '').trim().toUpperCase()).filter(Boolean));
    const existNames = new Set(ex.rows.map((r) => r.lname).filter(Boolean));
    const seenCode = new Set(), seenName = new Set();

    let inserted = 0; const errors = [];
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx] || {};
      const name = String(r.product_name || '').trim();
      const code = String(r.product_code || '').trim();
      const codeKey = code.toUpperCase(), nameKey = name.toLowerCase();

      if (!name) { errors.push({ row: idx + 2, message: 'Thiếu Tên sản phẩm — bỏ qua' }); continue; }
      if (code) {
        if (seenCode.has(codeKey)) { errors.push({ row: idx + 2, message: `Mã "${code}" bị trùng trong file — đã bỏ qua` }); continue; }
        if (existCodes.has(codeKey)) { errors.push({ row: idx + 2, message: `Mã "${code}" đã tồn tại trên hệ thống — đã bỏ qua` }); continue; }
      }
      if (seenName.has(nameKey)) { errors.push({ row: idx + 2, message: `Tên "${name}" bị trùng trong file — đã bỏ qua` }); continue; }
      if (existNames.has(nameKey)) { errors.push({ row: idx + 2, message: `Tên "${name}" đã tồn tại trên hệ thống — đã bỏ qua` }); continue; }

      const typeList = Array.isArray(r.product_types) ? r.product_types
        : (r.product_type ? String(r.product_type).split(',').map((s) => s.trim()) : []);
      const { types, primary } = normalizeTypes({ product_types: typeList });
      const prim = primary || 'Thành phẩm';
      const tps = types.length ? types : [prim];
      try {
        await db.query(
          `INSERT INTO products
             (product_code, product_name, production_area, category, product_type, product_types, product_group,
              unit, barcode_type, tracking_type, is_pqc_required, status, description)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
          [code || null, name, r.production_area || null, r.category || null, prim, JSON.stringify(tps),
           r.product_group || null, upUnit(r.unit), r.barcode_type || null, r.tracking_type || 'Theo lô',
           false, r.status || 'Hoạt động', r.description || null]);
        inserted++;
        if (code) { seenCode.add(codeKey); existCodes.add(codeKey); }
        seenName.add(nameKey); existNames.add(nameKey);
      } catch (e) { errors.push({ row: idx + 2, message: e.detail || e.message }); }
    }
    res.json({ inserted, failed: errors.length, errors: errors.slice(0, 50) });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi nhập sản phẩm' }); }
};

/**
 * DELETE /api/products/:id — soft delete
 */
exports.softDeleteProduct = async (req, res) => {
  try {
    const g = await guardDelete('products', req.params.id, {
      blocked: ['Hoạt động'],
      message: 'Không thể xóa sản phẩm đang "Hoạt động" — có thể đang dùng ở đơn hàng / BOM / lệnh SX / tồn kho. Vui lòng chuyển sang "Không hoạt động" trước, rồi mới xóa.',
      dependents: PRODUCT_DEPENDENTS,
    });
    if (g.notFound) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    if (g.blocked) return res.status(400).json({ message: g.message });

    const { rowCount } = await db.query(
      `UPDATE products SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy sản phẩm' });
    res.json({ message: 'Đã xóa sản phẩm' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi xóa sản phẩm' });
  }
};

/* ----------------- Tài liệu / hình ảnh đính kèm sản phẩm ----------------- */

// GET /api/products/:id/attachments — danh sách (không kèm data) + ảnh mới nhất để preview
exports.listAttachments = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, content_type, is_image, created_at
       FROM product_attachments WHERE product_id = $1 ORDER BY created_at DESC`, [req.params.id]);
    // ảnh mới nhất (kèm data) để hiển thị preview
    const prev = await db.query(
      `SELECT id, name, content_type, data FROM product_attachments
       WHERE product_id = $1 AND is_image = TRUE ORDER BY created_at DESC LIMIT 1`, [req.params.id]);
    res.json({ data: rows, preview: prev.rows[0] || null });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy tài liệu' }); }
};

// POST /api/products/:id/attachments — { name, content_type, data(base64 dataURL) }
exports.addAttachment = async (req, res) => {
  try {
    const { name, content_type, data } = req.body;
    if (!data) return res.status(400).json({ message: 'Thiếu nội dung file' });
    const isImage = String(content_type || '').startsWith('image/');
    const { rows } = await db.query(
      `INSERT INTO product_attachments (product_id, name, content_type, is_image, data)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, content_type, is_image, created_at`,
      [req.params.id, name || 'tài liệu', content_type || null, isImage, data]);
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi tải tài liệu lên' }); }
};

// GET /api/products/:id/attachments/:attId/file — lấy nội dung 1 file (để xem/tải)
exports.getAttachmentFile = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT name, content_type, data FROM product_attachments WHERE id = $1 AND product_id = $2`,
      [req.params.attId, req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy tài liệu' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy tài liệu' }); }
};

// DELETE /api/products/:id/attachments/:attId
exports.deleteAttachment = async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM product_attachments WHERE id = $1 AND product_id = $2`, [req.params.attId, req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy tài liệu' });
    res.json({ message: 'Đã xóa tài liệu' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa tài liệu' }); }
};
