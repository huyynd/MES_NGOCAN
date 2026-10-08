// backend/controllers/inventoryController.js
const db = require('../../core/db');
const { buildSpecKey, legacyAttrs, specsFromBody } = require('../../core/lib/specs');
const { upUnit } = require('../../core/lib/units');
const { getDataScope } = require('../../core/dataScope');
const { applyStock } = require('../../core/lib/stock');

// GET /api/inventory/tree — tồn kho (trả về dữ liệu phẳng để frontend tự nhóm)
exports.tree = async (req, res) => {
  try {
    const where = [];
    const params = []; let i = 1;
    const { product_id, q } = req.query;
    if (product_id) { where.push(`s.product_id = $${i++}`); params.push(product_id); }
    if (q)          { where.push(`(p.product_name ILIKE $${i} OR p.product_code ILIKE $${i} OR s.lot_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
    
    const invModules = ['inventory', 'rep_inv', 'inv_adjust', 'inv_inbound', 'inv_outbound', 'inv_transfer'];
    let scopeCond = '1=0';
    for (const mod of invModules) {
      scopeCond = getDataScope(req, mod, 'view', { warehouseCol: 'w.name' });
      if (scopeCond !== '1=0') break;
    }
    where.push(`(${scopeCond})`);

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
    const where = [];
    const params = []; let i = 1;
    const { product_id, warehouse_id, q } = req.query;
    if (product_id)   { where.push(`s.product_id = $${i++}`); params.push(product_id); }
    if (warehouse_id) { where.push(`l.warehouse_id = $${i++}`); params.push(warehouse_id); }
    if (q)            { where.push(`(p.product_name ILIKE $${i} OR p.product_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
    
    const invModules = ['inventory', 'rep_inv', 'inv_adjust', 'inv_inbound', 'inv_outbound', 'inv_transfer'];
    let scopeCond = '1=0';
    for (const mod of invModules) {
      scopeCond = getDataScope(req, mod, 'view', { warehouseCol: 'w.name' });
      if (scopeCond !== '1=0') break;
    }
    where.push(`(${scopeCond})`);

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
      LEFT JOIN production_orders po ON po.id = s.prod_order_id
      WHERE s.product_id = $1 AND ${whCond}
      ORDER BY l.name NULLS FIRST, s.spec_key, s.lot_code`, params);
    const prod = (await db.query(`SELECT id, product_code, product_name, product_type FROM products WHERE id = $1`, [product_id])).rows[0];
    let warehouse = null;
    if (warehouse_id) warehouse = (await db.query(`SELECT id, name, status FROM warehouses WHERE id = $1`, [warehouse_id])).rows[0];
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
    const specKey = buildSpecKey(specs);
    const lot = b.lot_code || '';
    const loc = b.location_id || null;
    const numOrNull = (v) => (v === '' || v == null ? null : v);
    const newQty = Number(b.quantity) || 0;

    await client.query('BEGIN');
    // Tồn cũ của đúng dòng (SP + vị trí + thông số + lô)
    const oldRow = (await client.query(
      `SELECT quantity FROM inventory_stock
       WHERE product_id=$1 AND location_id IS NOT DISTINCT FROM $2 AND spec_key=$3 AND lot_code=$4`,
      [b.product_id, loc, specKey, lot])).rows[0];
    const oldQty = oldRow ? Number(oldRow.quantity) : 0;
    const delta = newQty - oldQty;

    // Sửa tay = điều chỉnh tồn → ĐI QUA applyStock để GHI SỔ GIAO DỊCH (trước đây ghi thẳng, mất lịch sử)
    await applyStock(client, {
      product_id: b.product_id, location_id: loc, delta, unit: b.unit,
      specs, spec_key: specKey, lot_code: lot, clampZero: false,
      trx_type: 'Điều chỉnh', ref_code: b.ref_code || null,
      note: b.note || `Điều chỉnh/kiểm kê tồn (${oldQty} → ${newQty})`,
    });
    // Các trường phụ (hạn dùng / kiểm kê) applyStock không quản → cập nhật riêng
    await client.query(
      `UPDATE inventory_stock SET expiry_date=$1, counted_qty=$2, counted_date=$3, unit=COALESCE($4,unit), updated_at=now()
       WHERE product_id=$5 AND location_id IS NOT DISTINCT FROM $6 AND spec_key=$7 AND lot_code=$8`,
      [b.expiry_date || null, numOrNull(b.counted_qty), b.counted_date || null, upUnit(b.unit), b.product_id, loc, specKey, lot]);
    const { rows } = await client.query(
      `SELECT * FROM inventory_stock WHERE product_id=$1 AND location_id IS NOT DISTINCT FROM $2 AND spec_key=$3 AND lot_code=$4`,
      [b.product_id, loc, specKey, lot]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi thêm dòng tồn' }); }
  finally { client.release(); }
};

// DELETE /api/inventory/stock/:id — xóa 1 dòng tồn
exports.deleteStockLine = async (req, res) => {
  try {
    const { rowCount } = await db.query(`DELETE FROM inventory_stock WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy dòng tồn' });
    res.json({ message: 'Đã xóa dòng tồn' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa dòng tồn' }); }
};

// GET /api/inventory/transactions — lịch sử nhập/xuất/điều chỉnh
exports.transactions = async (req, res) => {
  try {
    const where = [];
    const params = []; let i = 1;
    const { product_id, trx_type, q } = req.query;
    if (product_id) { where.push(`tr.product_id = $${i++}`); params.push(product_id); }
    if (trx_type)   { where.push(`tr.trx_type = $${i++}`); params.push(trx_type); }
    if (q)          { where.push(`(p.product_name ILIKE $${i} OR p.product_code ILIKE $${i} OR tr.ref_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await db.query(`
      SELECT tr.*, p.product_name, p.product_code,
             l.name AS location_name, w.name AS warehouse_name
      FROM inventory_transactions tr
      JOIN products p ON p.id = tr.product_id
      LEFT JOIN locations l ON l.id = tr.location_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      ${whereSql} ORDER BY tr.created_at DESC LIMIT 300`, params);
    res.json({ data: rows });
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

exports.adjust = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    if (!b.product_id || b.quantity === undefined || !b.trx_type)
      return res.status(400).json({ message: 'Thiếu Sản phẩm / Số lượng / Loại giao dịch' });
    if (!VALID_TRX_TYPES.includes(b.trx_type))
      return res.status(400).json({ message: `Loại giao dịch không hợp lệ. Chỉ chấp nhận: ${VALID_TRX_TYPES.join(', ')}` });
    // Validate số lượng: phải là số khác 0; Nhập/Xuất phải > 0 (chặn "Nhập -20", "0", chữ…)
    const _qn = Number(b.quantity);
    if (!Number.isFinite(_qn) || _qn === 0)
      return res.status(400).json({ message: 'Số lượng phải là một số khác 0.' });
    if ((b.trx_type === 'Nhập' || b.trx_type === 'Xuất') && _qn <= 0)
      return res.status(400).json({ message: 'Số lượng Nhập/Xuất phải lớn hơn 0.' });
    // M14: bắt buộc vị trí kho hợp lệ — tồn không có vị trí (location_id NULL) không hiện ở cây kho,
    // không chuyển/xuất/giao được (mọi luồng đó JOIN qua locations).
    if (!b.location_id) return res.status(400).json({ message: 'Vui lòng chọn kho / vị trí.' });
    const locOk = (await client.query(
      `SELECT 1 FROM locations WHERE id = $1 AND is_deleted = FALSE`, [b.location_id])).rowCount;
    if (!locOk) return res.status(400).json({ message: 'Vị trí kho không tồn tại hoặc đã bị xoá.' });

    if (!req.user.is_admin) {
      let reqApp = 'inventory';
      if (b.trx_type === 'Nhập')       reqApp = 'inv_inbound';
      if (b.trx_type === 'Xuất')       reqApp = 'inv_outbound';
      if (b.trx_type === 'Điều chỉnh') reqApp = 'inv_adjust';
      const perms = req.user.permissions;
      const hasPerm =
        checkPerm(perms, reqApp, 'create') ||
        checkPerm(perms, reqApp, 'edit');
      const hasFallback =
        checkPerm(perms, 'inventory', 'edit') ||
        checkPerm(perms, 'inventory', 'create');

      if (!hasPerm && !hasFallback) {
        return res.status(403).json({ message: 'Bạn không có quyền thực hiện loại giao dịch này' });
      }
    }


    const delta = b.trx_type === 'Xuất' ? -Math.abs(Number(b.quantity)) : Number(b.quantity);
    const specs = specsFromBody(b);

    // Xuất: chặn khi thiếu tồn (thay vì ép về 0 mà sổ cái vẫn ghi đủ → lệch sổ cái)
    if (b.trx_type === 'Xuất') {
      const sk = buildSpecKey(specs);
      const onHand = Number((await client.query(
        `SELECT COALESCE(quantity,0) AS q FROM inventory_stock
         WHERE product_id = $1 AND location_id IS NOT DISTINCT FROM $2 AND spec_key = $3 AND lot_code = $4`,
        [b.product_id, b.location_id || null, sk, b.lot_code || ''])).rows[0]?.q || 0);
      if (Math.abs(Number(b.quantity)) > onHand + 1e-6) {
        return res.status(400).json({ message: `Không đủ tồn để xuất — tồn ${onHand}, cần xuất ${Math.abs(Number(b.quantity))}.` });
      }
    }

    await client.query('BEGIN');
    await applyStock(client, {
      product_id: b.product_id, location_id: b.location_id || null,
      delta, unit: b.unit, specs, lot_code: b.lot_code || '',
      trx_type: b.trx_type, ref_code: b.ref_code || null, note: b.note || null,
      clampZero: false,
    });
    await client.query('COMMIT');
    res.status(201).json({ message: 'Đã cập nhật tồn kho' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi điều chỉnh tồn kho' });
  } finally { client.release(); }
};

// ── PHIẾU XUẤT KHO (outbound slips) ───────────────────────────────────────────
// POST /api/outbound-slips — TẠO PHIẾU XUẤT KHO "Chờ xuất" (không trừ tồn ngay)
exports.createOutboundSlip = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { purpose, location_id, note, lines } = req.body;
    if (!location_id) return res.status(400).json({ message: 'Thiếu kho/vị trí xuất' });
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ message: 'Danh sách sản phẩm trống' });

    await client.query('BEGIN');

    // Sinh mã phiếu PXK00001…
    const slipCode = (await client.query(
      `SELECT 'PXK' || LPAD((COALESCE(MAX(NULLIF(regexp_replace(slip_code,'\\D','','g'),''))::int,0)+1)::text,5,'0') AS code
       FROM outbound_slips WHERE slip_code ~ '^PXK[0-9]+$'`)).rows[0].code;

    const slip = (await client.query(
      `INSERT INTO outbound_slips (slip_code, purpose, location_id, status, note, created_by)
       VALUES ($1,$2,$3,'Chờ xuất',$4,$5) RETURNING id, slip_code`,
      [slipCode, purpose || 'Khác', location_id, note || null, req.userId || null])).rows[0];

    for (const l of lines) {
      if (!l.product_id || Number(l.quantity) <= 0) continue;
      await client.query(
        `INSERT INTO outbound_slip_lines (slip_id, product_id, quantity, unit, lot_code, note) VALUES ($1,$2,$3,$4,$5,$6)`,
        [slip.id, l.product_id, Number(l.quantity), l.unit || null, l.lot_code || '', l.note || null]);
    }

    await client.query('COMMIT');
    res.json({ message: `Đã tạo phiếu chờ xuất kho ${slip.slip_code}.`, slip_code: slip.slip_code, slip_id: slip.id });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi tạo phiếu xuất' }); }
  finally { client.release(); }
};

// GET /api/outbound-slips?status= — danh sách phiếu (mặc định tất cả)
exports.listOutboundSlips = async (req, res) => {
  try {
    const where = []; const params = []; let i = 1;
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
      WHERE s.id = $1`, [req.params.id])).rows[0];
    if (!s) return res.status(404).json({ message: 'Không tìm thấy phiếu xuất' });
    const lines = (await db.query(`
      SELECT sl.*, p.product_code, p.product_name,
             COALESCE((SELECT SUM(quantity) FROM inventory_stock st WHERE st.product_id = sl.product_id), 0) AS on_hand
      FROM outbound_slip_lines sl JOIN products p ON p.id = sl.product_id
      WHERE sl.slip_id = $1 ORDER BY p.product_code`, [req.params.id])).rows;
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

    await client.query('BEGIN');
    // Chống bấm đúp / gọi đồng thời: chỉ MỘT request "chiếm" được phiếu từ Chờ xuất (atomic) → không trừ tồn 2 lần.
    // Thiếu tồn → ROLLBACK trả phiếu về Chờ xuất.
    const claim = await client.query(
      `UPDATE outbound_slips SET status = 'Đã xuất', confirmed_at = now() WHERE id = $1 AND status = 'Chờ xuất' RETURNING id`, [req.params.id]);
    if (!claim.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Phiếu đã được xuất hoặc đang được xử lý — vui lòng tải lại.' }); }

    // Gộp SL theo (sản phẩm, lô) TRƯỚC khi kiểm tồn — nhiều dòng cùng 1 SP không được kiểm độc lập
    // (vd 80 + 80 khi tồn 100 PHẢI báo thiếu). M50: dòng có ghi lô chỉ được trừ đúng lô đó.
    const needs = new Map(); // key product|lot → { product_id, lot_code, unit, qty }
    for (const l of lines) {
      const q = Number(l.quantity) || 0; if (q <= 0) continue;
      const lot = l.lot_code || '';
      const key = `${l.product_id}|${lot}`;
      const cur = needs.get(key) || { product_id: l.product_id, lot_code: lot, unit: l.unit, qty: 0 };
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
    // Dòng ghi lô xử lý trước, dòng không ghi lô lấy FIFO trên phần còn lại
    const ordered = [...needs.values()].sort((a, b) => (a.lot_code ? 0 : 1) - (b.lot_code ? 0 : 1));
    for (const n of ordered) {
      const pool = fifo.filter((r) => r.product_id === n.product_id && (!n.lot_code || r.lot_code === n.lot_code));
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
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi xác nhận xuất kho' }); }
  finally { client.release(); }
};

// POST /api/outbound-slips/:id/cancel — HỦY phiếu (chỉ khi Chờ xuất). Mở khóa lệnh SX nguồn.
exports.cancelOutboundSlip = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const s = (await client.query(`SELECT * FROM outbound_slips WHERE id = $1`, [req.params.id])).rows[0];
    if (!s) return res.status(404).json({ message: 'Không tìm thấy phiếu xuất' });
    if (s.status !== 'Chờ xuất') return res.status(400).json({ message: 'Chỉ hủy được phiếu đang Chờ xuất.' });
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

    // Kiểm tra quyền chuyển kho
    if (!req.user.is_admin) {
      const perms = req.user.permissions;
      const hasPerm = checkPerm(perms, 'inv_transfer', 'create') || checkPerm(perms, 'inv_transfer', 'edit');
      const hasFallback = checkPerm(perms, 'inventory', 'edit') || checkPerm(perms, 'inventory', 'create');
      if (!hasPerm && !hasFallback) {
        return res.status(403).json({ message: 'Bạn không có quyền chuyển kho' });
      }
    }

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
    const { rows: srcRows } = await client.query(
      `SELECT spec_key, specs, lot_code, quantity, unit FROM inventory_stock
       WHERE product_id = $1 AND location_id = $2 AND quantity > 0 AND ($3 = '' OR lot_code = $3)
       ORDER BY created_at, lot_code, id FOR UPDATE`, // M50: FIFO — lô vào kho sớm nhất chuyển trước
      [b.product_id, b.from_location_id, lot]);
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
      const common = { product_id: b.product_id, unit: sr.unit || unit, specs: sr.specs || {}, spec_key: sr.spec_key, lot_code: sr.lot_code || '', clampZero: false };
      // 1. Xuất khỏi kho nguồn
      await applyStock(client, { ...common, location_id: b.from_location_id, delta: -take, trx_type: 'Xuất', note: `Chuyển kho → ${toLabel}${b.note ? ' | ' + b.note : ''}` });
      // 2. Nhập vào kho đích (cùng spec_key + lô)
      await applyStock(client, { ...common, location_id: b.to_location_id, delta: take, trx_type: 'Nhập', note: `Chuyển kho ← ${fromLabel}${b.note ? ' | ' + b.note : ''}` });
      remain -= take;
    }

    await client.query('COMMIT');
    res.status(201).json({ message: `Đã chuyển ${qty} ${unit} từ ${fromLabel} → ${toLabel}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: err.detail || 'Lỗi khi chuyển kho' });
  } finally { client.release(); }
};
