// backend/controllers/inventoryController.js
const db = require('../../core/db');
const { buildSpecKey, legacyAttrs, specsFromBody, specKeyValues } = require('../../core/lib/specs');
const { upUnit } = require('../../core/lib/units');
const { getDataScope } = require('../../core/dataScope');
const { applyStock, stockErrorResponse } = require('../../core/lib/stock');
const { nextSlipCode } = require('../../core/lib/codes');

// A5: tồn của SP / kho / vị trí ĐÃ XÓA không hiển thị, không tính tổng (dữ liệu cũ vẫn giữ trong DB).
// Dòng tồn cũ không có vị trí (location_id NULL) của SP còn hoạt động vẫn hiện.
const NOT_DELETED = `p.is_deleted = FALSE AND COALESCE(l.is_deleted, FALSE) = FALSE AND COALESCE(w.is_deleted, FALSE) = FALSE`;

// K-08: điều kiện phạm vi kho khi ĐỌC (alias w = warehouses). Lấy module kho đầu tiên user được xem.
const INV_VIEW_MODULES = ['inventory', 'rep_inv', 'inv_adjust', 'inv_inbound', 'inv_outbound', 'inv_transfer'];
function invViewScope(req) {
  let cond = '1=0';
  for (const mod of INV_VIEW_MODULES) {
    cond = getDataScope(req, mod, 'view', { warehouseCol: 'w.name' });
    if (cond !== '1=0') break;
  }
  return cond;
}

// K-25: phạm vi kho khi GHI. Quyền dạng { status:'ALLOW', scope:'WAREHOUSE', scopeValue } chỉ ghi được đúng kho đó.
function permAllowsWarehouse(pval, whName) {
  if (!pval) return false;
  if (pval === true || pval === 'ALLOW') return true;
  if (typeof pval !== 'object' || pval.status !== 'ALLOW') return false;
  if (pval.scope === 'WAREHOUSE' && pval.scopeValue) return pval.scopeValue === whName;
  return true;
}
// Trả null nếu được ghi; ngược lại trả thông báo lỗi 403.
async function writeDenied(client, req, locationId, modules, actions = ['create', 'edit']) {
  if (req.user?.is_admin) return null;
  const perms = req.user?.permissions || {};
  const hasAny = modules.some((m) => actions.some((a) => checkPerm(perms, m, a)));
  if (!hasAny) return 'Bạn không có quyền thực hiện thao tác này.';
  if (!locationId) return null;
  const whName = (await client.query(
    `SELECT w.name FROM locations l LEFT JOIN warehouses w ON w.id = l.warehouse_id WHERE l.id = $1`, [locationId])).rows[0]?.name;
  const ok = modules.some((m) => actions.some((a) => permAllowsWarehouse(perms[m]?.[a], whName)));
  return ok ? null : `Bạn không có quyền ghi vào kho "${whName || '?'}" (ngoài phạm vi kho được giao).`;
}

// K-04/K-05: xác định thông số (spec_key) của dòng tồn cần TRỪ khi người dùng không chỉ rõ.
//   Có chỉ rõ → dùng đúng. Không chỉ rõ: tại vị trí (+ lô nếu có) chỉ có 1 thông số còn hàng → dùng nó;
//   nhiều thông số → báo lỗi bắt chọn (trước đây lấy FIFO lẫn màu / kích thước).
class SpecChoiceError extends Error {
  constructor(message) { super(message); this.status = 400; this.code = 'SPEC_CHOICE'; }
}
async function resolveOutSpec(client, { product_id, location_id, lot_code, spec_key }) {
  if (spec_key != null && spec_key !== '') {
    const row = (await client.query(
      `SELECT specs FROM inventory_stock WHERE product_id=$1 AND location_id IS NOT DISTINCT FROM $2 AND spec_key=$3 LIMIT 1`,
      [product_id, location_id, spec_key])).rows[0];
    return { spec_key, specs: row?.specs || {} };
  }
  const { rows } = await client.query(
    `SELECT spec_key, MAX(specs::text)::jsonb AS specs FROM inventory_stock
      WHERE product_id=$1 AND location_id IS NOT DISTINCT FROM $2 AND quantity > 0 AND ($3 = '' OR lot_code = $3)
      GROUP BY spec_key ORDER BY spec_key`, [product_id, location_id, lot_code || '']);
  if (rows.length === 1) return { spec_key: rows[0].spec_key, specs: rows[0].specs || {} };
  if (rows.length > 1) {
    const p = (await client.query(`SELECT product_code, product_name FROM products WHERE id = $1`, [product_id])).rows[0] || {};
    const list = rows.map((r) => specLabel(r.spec_key)).join('; ');
    throw new SpecChoiceError(`${p.product_code || ''} ${p.product_name || ''}: tại vị trí này có nhiều thông số (${list}) — vui lòng chọn đúng thông số cần xuất/chuyển.`);
  }
  return { spec_key: buildSpecKey({}), specs: {} };
}
const specLabel = (k) => (specKeyValues(k).join(' · ') || 'không thông số');
function specErrorResponse(res, err) {
  if (err && err.code === 'SPEC_CHOICE') { res.status(400).json({ message: err.message, code: err.code }); return true; }
  return false;
}

// GET /api/inventory/tree — tồn kho (trả về dữ liệu phẳng để frontend tự nhóm)
exports.tree = async (req, res) => {
  try {
    const where = [NOT_DELETED];
    const params = []; let i = 1;
    const { product_id, q } = req.query;
    if (product_id) { where.push(`s.product_id = $${i++}`); params.push(product_id); }
    if (q)          { where.push(`(p.product_name ILIKE $${i} OR p.product_code ILIKE $${i} OR s.lot_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
    where.push(`(${invViewScope(req)})`);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await db.query(`
      SELECT s.id, s.product_id, p.product_code, p.product_name, p.product_type, p.min_quantity, p.warehouse_limits,
             s.spec_key, s.specs, s.lot_code, s.prod_order_id, po.order_code AS lot_order_code,
             s.quantity, s.unit, s.expiry_date,
             w.id AS warehouse_id, w.name AS warehouse_name, 
             z.id AS zone_id, z.name AS zone_name,
             l.id AS location_id, l.name AS location_name
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN locations l ON l.id = s.location_id
      LEFT JOIN zones z ON z.id = l.zone_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      LEFT JOIN production_orders po ON po.id = s.prod_order_id
      ${whereSql}
      ORDER BY p.product_code, s.spec_key, s.lot_code`, params);

    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy dữ liệu tồn kho' }); }
};

// GET /api/inventory — tồn kho GỘP theo sản phẩm + kho (mỗi (SP, kho) là 1 dòng)
exports.list = async (req, res) => {
  try {
    const where = [NOT_DELETED];
    const params = []; let i = 1;
    const { product_id, warehouse_id, q } = req.query;
    if (product_id)   { where.push(`s.product_id = $${i++}`); params.push(product_id); }
    if (warehouse_id) { where.push(`l.warehouse_id = $${i++}`); params.push(warehouse_id); }
    if (q)            { where.push(`(p.product_name ILIKE $${i} OR p.product_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
    where.push(`(${invViewScope(req)})`);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await db.query(`
      SELECT p.id AS product_id, p.product_code, p.product_name, p.product_type,
             w.id AS warehouse_id, w.name AS warehouse_name, w.warehouse_type,
             SUM(s.quantity) AS quantity, MAX(s.unit) AS unit, COUNT(*)::int AS line_count
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN locations l ON l.id = s.location_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      ${whereSql}
      GROUP BY p.id, w.id, w.name, w.warehouse_type
      ORDER BY p.product_code, w.name
    `, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy tồn kho' }); }
};

// GET /api/inventory/detail?product_id&warehouse_id — chi tiết các dòng tồn (theo vị trí) của 1 (SP, kho)
exports.stockDetail = async (req, res) => {
  try {
    const { product_id, warehouse_id } = req.query;
    if (!product_id) return res.status(400).json({ message: 'Thiếu product_id' });
    const params = [product_id]; let i = 2;
    let whCond;
    if (warehouse_id) { whCond = `l.warehouse_id = $${i++}`; params.push(warehouse_id); }
    else whCond = `l.warehouse_id IS NULL`;
    const lines = await db.query(`
      SELECT s.id, s.location_id, l.name AS location_name,
             s.specs, s.spec_key, s.lot_code, po.order_code AS lot_order_code,
             s.attr_size, s.attr_thickness, s.attr_color, s.quantity, s.unit,
             s.expiry_date, s.counted_qty, s.counted_date
      FROM inventory_stock s
      LEFT JOIN locations l ON l.id = s.location_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      LEFT JOIN production_orders po ON po.id = s.prod_order_id
      WHERE s.product_id = $1 AND ${whCond} AND COALESCE(l.is_deleted, FALSE) = FALSE AND (${invViewScope(req)})
      ORDER BY l.name NULLS FIRST, s.spec_key, s.lot_code`, params);
    const prod = (await db.query(`SELECT id, product_code, product_name, product_type FROM products WHERE id = $1`, [product_id])).rows[0];
    let warehouse = null;
    if (warehouse_id) warehouse = (await db.query(
      `SELECT w.id, w.name, w.status FROM warehouses w WHERE w.id = $1 AND (${invViewScope(req)})`, [warehouse_id])).rows[0] || null;
    res.json({ product: prod, warehouse, lines: lines.rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết tồn kho' }); }
};

// POST /api/inventory/stock — thêm / cập nhật 1 dòng tồn (điều chỉnh chủ động)
exports.addStockLine = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    if (!b.product_id) return res.status(400).json({ message: 'Thiếu sản phẩm' });
    const specs = specsFromBody(b);
    // K-01: kiểm kê đúng 1 dòng tồn có sẵn → client gửi kèm spec_key của dòng đó
    const specKey = b.spec_key != null && b.spec_key !== '' ? b.spec_key : buildSpecKey(specs);
    const lot = b.lot_code || '';
    const loc = b.location_id || null;
    const numOrNull = (v) => (v === '' || v == null ? null : v);
    const newQty = Number(b.quantity);
    if (!Number.isFinite(newQty) || newQty < 0) return res.status(400).json({ message: 'Số lượng thực tế phải là số ≥ 0.' });

    const denied = await writeDenied(client, req, loc, ['inv_adjust', 'inventory']);
    if (denied) return res.status(403).json({ message: denied });

    await client.query('BEGIN');
    // K-07: khóa đúng dòng (SP + vị trí + thông số + lô) trước khi đọc tồn cũ — 2 lần kiểm kê đồng thời
    // phải chạy lần lượt, lần sau đọc số mới (trước đây cùng đọc 50 → cộng/trừ chồng nhau). Khóa advisory
    // phủ cả trường hợp dòng chưa tồn tại (FOR UPDATE không khóa được dòng chưa có).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`stock:${b.product_id}|${loc}|${specKey}|${lot}`]);
    const oldRow = (await client.query(
      `SELECT quantity FROM inventory_stock
       WHERE product_id=$1 AND location_id IS NOT DISTINCT FROM $2 AND spec_key=$3 AND lot_code=$4 FOR UPDATE`,
      [b.product_id, loc, specKey, lot])).rows[0];
    const oldQty = oldRow ? Number(oldRow.quantity) : 0;
    // Màn kiểm kê gửi kèm số hệ thống người dùng đã thấy: tồn đã đổi trong lúc đếm → không ghi đè, bắt tải lại.
    if (b.expected_qty != null && b.expected_qty !== '' && Math.abs(Number(b.expected_qty) - oldQty) > 1e-6) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: `Tồn hệ thống vừa thay đổi (${Number(b.expected_qty).toLocaleString('vi-VN')} → ${oldQty.toLocaleString('vi-VN')}) — vui lòng tải lại rồi kiểm kê lại.`, current_qty: oldQty });
    }
    const delta = newQty - oldQty;

    // Sửa tay = điều chỉnh tồn → ĐI QUA applyStock để GHI SỔ GIAO DỊCH (trước đây ghi thẳng, mất lịch sử)
    await applyStock(client, {
      product_id: b.product_id, location_id: loc, delta, unit: b.unit,
      specs, spec_key: specKey, lot_code: lot, clampZero: false,
      trx_type: 'Điều chỉnh', ref_code: b.ref_code || null,
      note: b.note || `Điều chỉnh/kiểm kê tồn (${oldQty} → ${newQty})`,
    });
    // Các trường phụ (hạn dùng / kiểm kê) applyStock không quản → cập nhật riêng.
    // Chỉ ghi trường nào request CÓ gửi (màn kiểm kê không gửi → không xóa hạn dùng đang có).
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
    await client.query(
      `UPDATE inventory_stock SET
         expiry_date  = CASE WHEN $1 THEN $2::date ELSE expiry_date END,
         counted_qty  = CASE WHEN $3 THEN $4::numeric ELSE counted_qty END,
         counted_date = CASE WHEN $5 THEN $6::date ELSE counted_date END,
         unit=COALESCE($7,unit), updated_at=now()
       WHERE product_id=$8 AND location_id IS NOT DISTINCT FROM $9 AND spec_key=$10 AND lot_code=$11`,
      [has('expiry_date'), b.expiry_date || null, has('counted_qty'), numOrNull(b.counted_qty),
       has('counted_date'), b.counted_date || null, upUnit(b.unit), b.product_id, loc, specKey, lot]);
    const { rows } = await client.query(
      `SELECT * FROM inventory_stock WHERE product_id=$1 AND location_id IS NOT DISTINCT FROM $2 AND spec_key=$3 AND lot_code=$4`,
      [b.product_id, loc, specKey, lot]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); console.error(err); if (stockErrorResponse(res, err)) return; res.status(500).json({ message: err.detail || 'Lỗi khi thêm dòng tồn' }); }
  finally { client.release(); }
};

// DELETE /api/inventory/stock/:id — xóa 1 dòng tồn ĐÃ HẾT HÀNG (quantity = 0).
// Dòng còn hàng KHÔNG được xóa thẳng: tồn sẽ biến mất mà sổ cái không ghi → lệch sổ cái (RC3).
// Muốn bỏ hàng thì xuất / điều chỉnh về 0 (có ghi sổ) rồi mới xóa dòng.
exports.deleteStockLine = async (req, res) => {
  try {
    const cur = (await db.query(`SELECT quantity FROM inventory_stock WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ message: 'Không tìm thấy dòng tồn' });
    if (Number(cur.quantity) !== 0) {
      return res.status(400).json({ message: `Dòng tồn còn ${Number(cur.quantity).toLocaleString('vi-VN')} — không xóa thẳng được (sổ cái sẽ lệch). Hãy xuất hoặc điều chỉnh về 0 trước rồi mới xóa.` });
    }
    const { rowCount } = await db.query(`DELETE FROM inventory_stock WHERE id = $1 AND quantity = 0`, [req.params.id]);
    if (!rowCount) return res.status(409).json({ message: 'Dòng tồn vừa thay đổi — vui lòng tải lại.' });
    res.json({ message: 'Đã xóa dòng tồn' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa dòng tồn' }); }
};

// GET /api/inventory/transactions — lịch sử nhập/xuất/điều chỉnh
exports.transactions = async (req, res) => {
  try {
    const where = [`(${invViewScope(req)})`]; // K-08: chỉ lịch sử của kho trong phạm vi
    const params = []; let i = 1;
    const { product_id, trx_type, q, date_from, date_to, warehouse_id, note_prefix } = req.query;
    if (product_id) { where.push(`tr.product_id = $${i++}`); params.push(product_id); }
    if (trx_type)   { where.push(`tr.trx_type = $${i++}`); params.push(trx_type); }
    if (q)          { where.push(`(p.product_name ILIKE $${i} OR p.product_code ILIKE $${i} OR tr.ref_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
    // K-20: lọc theo ngày (giờ VN) / kho / tiền tố ghi chú — trước đây chỉ có 300 dòng mới nhất, không lọc được
    if (date_from)  { where.push(`(tr.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= $${i++}::date`); params.push(date_from); }
    if (date_to)    { where.push(`(tr.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= $${i++}::date`); params.push(date_to); }
    if (warehouse_id) { where.push(`l.warehouse_id = $${i++}`); params.push(warehouse_id); }
    if (note_prefix) { where.push(`tr.note LIKE $${i++}`); params.push(`${String(note_prefix).replace(/[%_\\]/g, '\\$&')}%`); }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 2000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await db.query(`
      SELECT tr.*, p.product_name, p.product_code, p.unit AS unit, -- sổ cái không lưu ĐVT → lấy ĐVT sản phẩm
             l.name AS location_name, w.name AS warehouse_name
      FROM inventory_transactions tr
      JOIN products p ON p.id = tr.product_id
      LEFT JOIN locations l ON l.id = tr.location_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      ${whereSql} ORDER BY tr.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows, limit, offset, has_more: rows.length === limit });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy lịch sử giao dịch' }); }
};

// POST /api/inventory/adjust — nhập/xuất/điều chỉnh, upsert tồn + ghi giao dịch
const VALID_TRX_TYPES = ['Nhập', 'Xuất', 'Điều chỉnh'];

// Helper: kiểm tra 1 action trong permissions, hỗ trợ cả 3 định dạng:
//   - boolean true (cũ)
//   - string 'ALLOW' (cũ)
//   - object { status: 'ALLOW', scope: '...' } (mới)
function checkPerm(permissions, moduleKey, action) {
  const mod = permissions?.[moduleKey];
  if (!mod) return false;
  const pval = mod[action];
  if (!pval) return false;
  if (typeof pval === 'object') return pval.status === 'ALLOW';
  return pval === 'ALLOW' || pval === true;
}

// Body 1 dòng (cũ):   { product_id, quantity, trx_type, location_id, unit, lot_code, specs | spec_key, ref_code, note }
// Body CHỨNG TỪ (K-03): { trx_type, location_id, ref_code, note, lines: [{ product_id, quantity, unit, lot_code, spec_key, note }] }
//   → mọi dòng ghi trong MỘT transaction: 1 dòng lỗi thì cả phiếu không ghi.
//   → có ref_code: số phiếu đã ghi rồi (cùng loại) thì từ chối 409 — chống bấm đúp / gửi lại nhân đôi tồn.
exports.adjust = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body || {};
    const isDoc = Array.isArray(b.lines);
    const lines = isDoc ? b.lines : [b];
    const trxType = b.trx_type;
    const locationId = b.location_id || null;
    const lineErr = (idx, msg) => res.status(400).json({ message: isDoc ? `Dòng ${idx + 1}: ${msg}` : msg });

    if (!trxType) return res.status(400).json({ message: 'Thiếu Loại giao dịch' });
    if (!VALID_TRX_TYPES.includes(trxType))
      return res.status(400).json({ message: `Loại giao dịch không hợp lệ. Chỉ chấp nhận: ${VALID_TRX_TYPES.join(', ')}` });
    if (!lines.length) return res.status(400).json({ message: 'Phiếu chưa có dòng hàng.' });
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k] || {};
      if (!l.product_id || l.quantity === undefined) return lineErr(k, 'Thiếu Sản phẩm / Số lượng');
      // Validate số lượng: phải là số khác 0; Nhập/Xuất phải > 0 (chặn "Nhập -20", "0", chữ…)
      const qn = Number(l.quantity);
      if (!Number.isFinite(qn) || qn === 0) return lineErr(k, 'Số lượng phải là một số khác 0.');
      if ((trxType === 'Nhập' || trxType === 'Xuất') && qn <= 0) return lineErr(k, 'Số lượng Nhập/Xuất phải lớn hơn 0.');
    }
    // M14: bắt buộc vị trí kho hợp lệ — tồn không có vị trí (location_id NULL) không hiện ở cây kho,
    // không chuyển/xuất/giao được (mọi luồng đó JOIN qua locations).
    if (!locationId) return res.status(400).json({ message: 'Vui lòng chọn kho / vị trí.' });
    const locOk = (await client.query(
      `SELECT 1 FROM locations WHERE id::text = $1 AND is_deleted = FALSE`, [String(locationId)])).rowCount;
    if (!locOk) return res.status(400).json({ message: 'Vị trí kho không tồn tại hoặc đã bị xoá.' });
    // K-23: SP không tồn tại → 400 (trước đây lỗi khóa ngoại 500)
    const pids = [...new Set(lines.map((l) => String(l.product_id)))];
    const okP = (await client.query(
      `SELECT id::text AS id FROM products WHERE id::text = ANY($1::text[]) AND is_deleted = FALSE`, [pids])).rows.map((r) => r.id);
    const badIdx = lines.findIndex((l) => !okP.includes(String(l.product_id)));
    if (badIdx >= 0) return lineErr(badIdx, 'Sản phẩm không tồn tại hoặc đã bị xoá.');

    // Quyền theo loại giao dịch + K-25: phạm vi kho áp cho cả GHI
    const reqApp = { 'Nhập': 'inv_inbound', 'Xuất': 'inv_outbound', 'Điều chỉnh': 'inv_adjust' }[trxType] || 'inventory';
    const denied = await writeDenied(client, req, locationId, [reqApp, 'inventory']);
    if (denied) return res.status(403).json({ message: denied });

    await client.query('BEGIN');
    if (isDoc && b.ref_code) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`invdoc:${trxType}:${b.ref_code}`]);
      const dup = (await client.query(
        `SELECT 1 FROM inventory_transactions WHERE ref_code = $1 AND trx_type = $2 LIMIT 1`, [b.ref_code, trxType])).rowCount;
      if (dup) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: `Phiếu ${b.ref_code} đã được ghi trước đó (có thể do bấm 2 lần) — không ghi lại. Vui lòng tải lại để kiểm tra.` });
      }
    }

    for (const l of lines) {
      const qn = Number(l.quantity);
      const delta = trxType === 'Xuất' ? -Math.abs(qn) : qn;
      const lot = l.lot_code || '';
      let specs = specsFromBody(l);
      let specKey = l.spec_key != null && l.spec_key !== '' ? l.spec_key : null;
      // K-04/K-05: trừ tồn mà không nói rõ thông số → tự nhận nếu vị trí chỉ có 1 thông số, nhiều thì bắt chọn
      if (delta < 0 && (specKey || buildSpecKey(specs) === buildSpecKey({}))) {
        const r = await resolveOutSpec(client, { product_id: l.product_id, location_id: locationId, lot_code: lot, spec_key: specKey });
        specKey = r.spec_key; specs = r.specs;
      }
      // Xuất: applyStock tự chặn khi thiếu tồn (atomic, không ép về 0)
      await applyStock(client, {
        product_id: l.product_id, location_id: locationId,
        delta, unit: l.unit, specs, spec_key: specKey, lot_code: lot,
        trx_type: trxType, ref_code: b.ref_code || l.ref_code || null, note: l.note || b.note || null,
        clampZero: false,
      });
    }
    await client.query('COMMIT');
    res.status(201).json({ message: isDoc ? `Đã ghi phiếu ${lines.length} dòng` : 'Đã cập nhật tồn kho', count: lines.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (stockErrorResponse(res, err) || specErrorResponse(res, err)) return;
    res.status(500).json({ message: err.detail || 'Lỗi khi điều chỉnh tồn kho' });
  } finally { client.release(); }
};

// ── PHIẾU XUẤT KHO (outbound slips) ───────────────────────────────────────────
// POST /api/outbound-slips — TẠO PHIẾU XUẤT KHO "Chờ xuất" (không trừ tồn ngay)
exports.createOutboundSlip = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { purpose, location_id, note, lines } = req.body;
    if (!location_id) return res.status(400).json({ message: 'Thiếu kho/vị trí xuất' });
    const validLines = Array.isArray(lines) ? lines.filter((l) => l && l.product_id && Number(l.quantity) > 0) : [];
    if (!validLines.length) return res.status(400).json({ message: 'Danh sách sản phẩm trống' });
    const locOk = (await client.query(
      `SELECT 1 FROM locations WHERE id::text = $1 AND is_deleted = FALSE`, [String(location_id)])).rowCount;
    if (!locOk) return res.status(400).json({ message: 'Vị trí kho không tồn tại hoặc đã bị xoá.' });
    const denied = await writeDenied(client, req, location_id, ['inv_outbound', 'inventory']);
    if (denied) return res.status(403).json({ message: denied });

    await client.query('BEGIN');

    // Sinh mã phiếu PXK00001… (D1: khóa theo bảng — tạo đồng thời không trùng mã)
    const slipCode = await nextSlipCode(client);

    const slip = (await client.query(
      `INSERT INTO outbound_slips (slip_code, purpose, location_id, status, note, created_by)
       VALUES ($1,$2,$3,'Chờ xuất',$4,$5) RETURNING id, slip_code`,
      [slipCode, purpose || 'Khác', location_id, note || null, req.userId || null])).rows[0];

    for (const l of validLines) {
      // K-05: lưu thông số đã chọn (NULL = không chỉ định) để lúc xác nhận trừ đúng màu / kích thước
      await client.query(
        `INSERT INTO outbound_slip_lines (slip_id, product_id, quantity, unit, lot_code, spec_key, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [slip.id, l.product_id, Number(l.quantity), l.unit || null, l.lot_code || '', l.spec_key || null, l.note || null]);
    }

    await client.query('COMMIT');
    res.json({ message: `Đã tạo phiếu chờ xuất kho ${slip.slip_code}.`, slip_code: slip.slip_code, slip_id: slip.id });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi tạo phiếu xuất' }); }
  finally { client.release(); }
};

// GET /api/outbound-slips?status= — danh sách phiếu (mặc định tất cả)
exports.listOutboundSlips = async (req, res) => {
  try {
    const where = [`(${invViewScope(req)})`]; const params = []; let i = 1; // K-08: phạm vi kho
    if (req.query.status) { where.push(`s.status = $${i++}`); params.push(req.query.status); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await db.query(`
      SELECT s.*, po.order_code AS prod_order_code,
             w.name AS warehouse_name, l.name AS location_name,
             (SELECT COUNT(*)::int FROM outbound_slip_lines sl WHERE sl.slip_id = s.id) AS line_count,
             (SELECT COALESCE(SUM(sl.quantity),0) FROM outbound_slip_lines sl WHERE sl.slip_id = s.id) AS total_qty
      FROM outbound_slips s
      LEFT JOIN production_orders po ON po.id = s.prod_order_id
      LEFT JOIN locations l ON l.id = s.location_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      ${whereSql} ORDER BY s.created_at DESC LIMIT 300`, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy danh sách phiếu xuất' }); }
};

// GET /api/outbound-slips/:id — chi tiết phiếu + dòng + tồn kho hiện tại
exports.getOutboundSlip = async (req, res) => {
  try {
    const s = (await db.query(`
      SELECT s.*, po.order_code AS prod_order_code, w.name AS warehouse_name, l.name AS location_name
      FROM outbound_slips s
      LEFT JOIN production_orders po ON po.id = s.prod_order_id
      LEFT JOIN locations l ON l.id = s.location_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      WHERE s.id = $1 AND (${invViewScope(req)})`, [req.params.id])).rows[0]; // K-08: ngoài phạm vi = không thấy
    if (!s) return res.status(404).json({ message: 'Không tìm thấy phiếu xuất' });
    // K-18: tồn hiện tại TẠI VỊ TRÍ XUẤT của phiếu (đúng lô / thông số nếu dòng có chỉ định), không phải tổng mọi kho
    const lines = (await db.query(`
      SELECT sl.*, p.product_code, p.product_name,
             COALESCE((SELECT SUM(quantity) FROM inventory_stock st
                        WHERE st.product_id = sl.product_id AND st.location_id = COALESCE(sl.location_id, $2::uuid)
                          AND (COALESCE(sl.lot_code, '') = '' OR st.lot_code = sl.lot_code)
                          AND (sl.spec_key IS NULL OR st.spec_key = sl.spec_key)), 0) AS on_hand
      FROM outbound_slip_lines sl JOIN products p ON p.id = sl.product_id
      WHERE sl.slip_id = $1 ORDER BY p.product_code`, [req.params.id, s.location_id])).rows;
    res.json({ data: { ...s, lines } });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết phiếu xuất' }); }
};

// POST /api/outbound-slips/:id/confirm — XÁC NHẬN xuất kho → TRỪ TỒN (1 lần). Chặn nếu tồn không đủ.
exports.confirmOutboundSlip = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const s = (await client.query(`SELECT * FROM outbound_slips WHERE id = $1`, [req.params.id])).rows[0];
    if (!s) return res.status(404).json({ message: 'Không tìm thấy phiếu xuất' });
    if (s.status === 'Đã xuất') return res.status(400).json({ message: 'Phiếu này đã được xuất kho rồi.' });
    if (s.status === 'Đã hủy') return res.status(400).json({ message: 'Phiếu đã hủy, không thể xuất.' });
    const lines = (await client.query(`SELECT * FROM outbound_slip_lines WHERE slip_id = $1`, [req.params.id])).rows;
    if (!lines.length) return res.status(400).json({ message: 'Phiếu chưa có dòng hàng.' });
    const denied = await writeDenied(client, req, s.location_id, ['inv_outbound'], ['confirm']); // K-25
    if (denied) return res.status(403).json({ message: denied });

    await client.query('BEGIN');
    // Chống bấm đúp / gọi đồng thời: chỉ MỘT request "chiếm" được phiếu từ Chờ xuất (atomic) → không trừ tồn 2 lần.
    // Thiếu tồn → ROLLBACK trả phiếu về Chờ xuất.
    const claim = await client.query(
      `UPDATE outbound_slips SET status = 'Đã xuất', confirmed_at = now() WHERE id = $1 AND status = 'Chờ xuất' RETURNING id`, [req.params.id]);
    if (!claim.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Phiếu đã được xuất hoặc đang được xử lý — vui lòng tải lại.' }); }

    // Gộp SL theo (sản phẩm, lô) TRƯỚC khi kiểm tồn — nhiều dòng cùng 1 SP không được kiểm độc lập
    // (vd 80 + 80 khi tồn 100 PHẢI báo thiếu). M50: dòng có ghi lô chỉ được trừ đúng lô đó.
    // K-05: dòng có chọn thông số (spec_key) chỉ trừ đúng thông số đó.
    const needs = new Map(); // key product|lot|spec → { product_id, lot_code, spec_key, unit, qty }
    for (const l of lines) {
      const q = Number(l.quantity) || 0; if (q <= 0) continue;
      const lot = l.lot_code || '';
      const spec = l.spec_key || null;
      const key = `${l.product_id}|${lot}|${spec ?? ''}`;
      const cur = needs.get(key) || { product_id: l.product_id, lot_code: lot, spec_key: spec, unit: l.unit, qty: 0 };
      cur.qty += q; needs.set(key, cur);
    }
    const productIds = [...new Set([...needs.values()].map((n) => n.product_id))];

    // M50: khoá tồn tại vị trí xuất TRONG transaction (2 phiếu khác nhau cùng xác nhận không trừ quá tồn).
    // Khoá theo id cho thứ tự khoá cố định (tránh deadlock), rồi xếp FIFO: lô vào kho sớm nhất trước.
    const { rows: locked } = await client.query(
      `SELECT id, product_id, lot_code, quantity, unit, spec_key, specs, created_at
       FROM inventory_stock
       WHERE product_id = ANY($1::uuid[]) AND location_id = $2 AND quantity > 0
       ORDER BY id FOR UPDATE`,
      [productIds, s.location_id]);
    const fifo = locked
      .map((r) => ({ ...r, left: Number(r.quantity) }))
      .sort((a, b) => (a.created_at - b.created_at) || String(a.lot_code).localeCompare(String(b.lot_code)) || String(a.id).localeCompare(String(b.id)));

    const shortages = [];
    const allocations = []; // { product_id, lot_code, spec_key, specs, quantity, unit }
    // Dòng chỉ định càng cụ thể (lô, thông số) xử lý trước; dòng không chỉ định lấy FIFO trên phần còn lại
    const rank = (n) => (n.lot_code ? 0 : 2) + (n.spec_key ? 0 : 1);
    const ordered = [...needs.values()].sort((a, b) => rank(a) - rank(b));
    for (const n of ordered) {
      const pool = fifo.filter((r) => r.product_id === n.product_id && (!n.lot_code || r.lot_code === n.lot_code)
        && (!n.spec_key || r.spec_key === n.spec_key));
      // Phiếu xuất tay (không phải phiếu NVL của lệnh SX) không chọn thông số mà vị trí có nhiều thông số
      // → không tự đoán (trước đây FIFO lẫn màu → xuất nhầm). Bắt chọn lại khi lập phiếu.
      if (!n.spec_key && !s.prod_order_id) {
        const kinds = [...new Set(pool.filter((r) => r.left > 1e-9).map((r) => r.spec_key))];
        if (kinds.length > 1) {
          await client.query('ROLLBACK');
          const p = (await client.query(`SELECT product_code, product_name FROM products WHERE id = $1`, [n.product_id])).rows[0] || {};
          return res.status(400).json({ message: `${p.product_code || ''} ${p.product_name || ''}: vị trí xuất có nhiều thông số (${kinds.map(specLabel).join('; ')}) nhưng dòng phiếu không chọn thông số — vui lòng hủy phiếu và lập lại có chọn thông số.` });
        }
      }
      const onHand = pool.reduce((sum, r) => sum + r.left, 0);
      if (n.qty > onHand + 1e-9) {
        const p = (await client.query(`SELECT product_code, product_name, unit FROM products WHERE id = $1`, [n.product_id])).rows[0] || {};
        shortages.push({ code: p.product_code, name: p.product_name, lot_code: n.lot_code, unit: n.unit || p.unit || '', on_hand: onHand, need: n.qty, buy: n.qty - onHand });
        continue;
      }
      let remain = n.qty;
      for (const sr of pool) {
        if (remain <= 1e-9) break;
        const take = Math.min(remain, sr.left);
        if (take <= 0) continue;
        allocations.push({ product_id: n.product_id, lot_code: sr.lot_code || '', spec_key: sr.spec_key, specs: sr.specs || {}, quantity: take, unit: n.unit || sr.unit });
        sr.left -= take; remain -= take;
      }
    }

    if (shortages.length) {
      await client.query('ROLLBACK');
      const msg = 'Không đủ tồn kho tại vị trí xuất — vui lòng nhập/chuyển kho đến vị trí này trước:\n' +
        shortages.map((x) => `• ${x.code} ${x.name}${x.lot_code ? ` (lô ${x.lot_code})` : ''}: tồn ${x.on_hand} ${x.unit}, cần ${x.need} ${x.unit} → thiếu ${x.buy} ${x.unit}`).join('\n');
      return res.status(400).json({ message: msg, shortages });
    }

    for (const alloc of allocations) {
      // Trừ ĐÚNG dòng tồn đã phân bổ (giữ nguyên spec_key của lô) → không tạo dòng '' ảo
      await applyStock(client, {
        product_id: alloc.product_id, location_id: s.location_id,
        delta: -alloc.quantity, unit: alloc.unit,
        specs: alloc.specs, spec_key: alloc.spec_key, lot_code: alloc.lot_code,
        clampZero: false, trx_type: 'Xuất',
        ref_code: s.slip_code, note: s.purpose || 'Xuất kho',
      });
    }
    await client.query('COMMIT');
    res.json({ message: `Đã xác nhận xuất kho phiếu ${s.slip_code} (${lines.length} dòng).`, count: lines.length });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); if (stockErrorResponse(res, err)) return; res.status(500).json({ message: err.detail || 'Lỗi khi xác nhận xuất kho' }); }  finally { client.release(); }
};

// POST /api/outbound-slips/:id/cancel — HỦY phiếu (chỉ khi Chờ xuất). Mở khóa lệnh SX nguồn.
exports.cancelOutboundSlip = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const s = (await client.query(`SELECT * FROM outbound_slips WHERE id = $1`, [req.params.id])).rows[0];
    if (!s) return res.status(404).json({ message: 'Không tìm thấy phiếu xuất' });
    if (s.status !== 'Chờ xuất') return res.status(400).json({ message: 'Chỉ hủy được phiếu đang Chờ xuất.' });
    const denied = await writeDenied(client, req, s.location_id, ['inv_outbound'], ['confirm']); // K-25
    if (denied) return res.status(403).json({ message: denied });
    await client.query('BEGIN');
    await client.query(`UPDATE outbound_slips SET status = 'Đã hủy' WHERE id = $1`, [req.params.id]);
    if (s.prod_order_id) await client.query(`UPDATE production_orders SET materials_issued = FALSE WHERE id = $1`, [s.prod_order_id]);
    await client.query('COMMIT');
    res.json({ message: `Đã hủy phiếu ${s.slip_code}.` });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi hủy phiếu' }); }
  finally { client.release(); }
};

// ── CHUYỂN KHO (atomic: Xuất + Nhập trong 1 transaction) ──────────────────────
// POST /api/inventory/transfer
// Body: { product_id, from_location_id, to_location_id, quantity, unit, lot_code, note }
exports.transfer = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    if (!b.product_id)        return res.status(400).json({ message: 'Thiếu sản phẩm' });
    if (!b.from_location_id)  return res.status(400).json({ message: 'Thiếu kho/vị trí nguồn' });
    if (!b.to_location_id)    return res.status(400).json({ message: 'Thiếu kho/vị trí đích' });
    if (!b.quantity || Number(b.quantity) <= 0) return res.status(400).json({ message: 'Số lượng phải lớn hơn 0' });
    if (b.from_location_id === b.to_location_id) return res.status(400).json({ message: 'Kho nguồn và đích không được giống nhau' });

    // Kiểm tra quyền chuyển kho + K-25: kho NGUỒN phải thuộc phạm vi được giao (người giữ kho mới được đưa hàng ra)
    const denied = await writeDenied(client, req, b.from_location_id, ['inv_transfer', 'inventory']);
    if (denied) return res.status(403).json({ message: denied });

    const qty = Number(b.quantity);
    const lot = b.lot_code || '';
    const unit = upUnit(b.unit);

    // M01: mọi truy vấn đi qua `client` đang giữ — không xin thêm kết nối từ pool (db.query),
    // tránh 10 request cùng giữ 10 kết nối rồi chờ nhau mãi (treo toàn bộ API).
    const fromLoc = (await client.query(`SELECT l.name, w.name AS wname FROM locations l LEFT JOIN warehouses w ON w.id = l.warehouse_id WHERE l.id = $1`, [b.from_location_id])).rows[0];
    const toLoc   = (await client.query(`SELECT l.name, w.name AS wname FROM locations l LEFT JOIN warehouses w ON w.id = l.warehouse_id WHERE l.id = $1`, [b.to_location_id])).rows[0];
    const fromLabel = fromLoc ? `${fromLoc.wname || ''} · ${fromLoc.name}` : b.from_location_id;
    const toLabel   = toLoc   ? `${toLoc.wname   || ''} · ${toLoc.name}`   : b.to_location_id;

    await client.query('BEGIN');

    // M13: đọc tồn nguồn TRONG transaction, khoá dòng (FOR UPDATE) → kiểm đủ và trừ trên cùng số liệu.
    // Có chọn lô → chỉ lấy đúng lô đó (trước đây bỏ qua lô, lấy FIFO lô khác).
    // Giữ nguyên spec_key + lô khi chuyển để không tạo dòng '' ảo.
    // K-05: chỉ chuyển đúng 1 thông số (chọn ở màn chuyển kho; không chọn mà nguồn có nhiều thông số → bắt chọn).
    const { spec_key: srcSpec } = await resolveOutSpec(client, {
      product_id: b.product_id, location_id: b.from_location_id, lot_code: lot, spec_key: b.spec_key });
    const { rows: srcRows } = await client.query(
      `SELECT spec_key, specs, lot_code, quantity, unit FROM inventory_stock
       WHERE product_id = $1 AND location_id = $2 AND quantity > 0 AND ($3 = '' OR lot_code = $3) AND spec_key = $4
       ORDER BY created_at, lot_code, id FOR UPDATE`, // M50: FIFO — lô vào kho sớm nhất chuyển trước
      [b.product_id, b.from_location_id, lot, srcSpec]);
    const onHand = srcRows.reduce((s, r) => s + Number(r.quantity), 0);
    if (qty > onHand + 1e-9) {
      await client.query('ROLLBACK');
      const prod = (await client.query(`SELECT product_code, product_name FROM products WHERE id = $1`, [b.product_id])).rows[0] || {};
      return res.status(400).json({
        message: `Không đủ tồn kho tại kho nguồn${lot ? ` (lô ${lot})` : ''} — ${prod.product_code || ''} ${prod.product_name || ''}: tồn ${onHand}, cần chuyển ${qty}`,
      });
    }
    let remain = qty;
    for (const sr of srcRows) {
      if (remain <= 1e-9) break;
      const take = Math.min(remain, Number(sr.quantity));
      const common = { product_id: b.product_id, unit: sr.unit || unit, specs: sr.specs || {}, spec_key: sr.spec_key, lot_code: sr.lot_code || '', clampZero: false, transfer: true };
      // 1. Xuất khỏi kho nguồn
      await applyStock(client, { ...common, location_id: b.from_location_id, delta: -take, trx_type: 'Chuyển kho', note: `Chuyển kho → ${toLabel}${b.note ? ' | ' + b.note : ''}` });
      // 2. Nhập vào kho đích (cùng spec_key + lô)
      await applyStock(client, { ...common, location_id: b.to_location_id, delta: take, trx_type: 'Chuyển kho', note: `Chuyển kho ← ${fromLabel}${b.note ? ' | ' + b.note : ''}` });
      remain -= take;
    }

    await client.query('COMMIT');
    // F5: không gửi đơn vị → lấy từ dòng tồn / sản phẩm (trước đây hiện "Đã chuyển 2 null")
    const shownUnit = unit || upUnit(srcRows[0]?.unit)
      || upUnit((await client.query(`SELECT unit FROM products WHERE id = $1`, [b.product_id])).rows[0]?.unit) || '';
    res.status(201).json({ message: `Đã chuyển ${qty.toLocaleString('vi-VN')}${shownUnit ? ' ' + shownUnit : ''} từ ${fromLabel} → ${toLabel}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); if (stockErrorResponse(res, err) || specErrorResponse(res, err)) return;
    res.status(500).json({ message: err.detail || 'Lỗi khi chuyển kho' });
  } finally { client.release(); }
};
