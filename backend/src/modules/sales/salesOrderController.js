// backend/controllers/salesOrderController.js — Đơn hàng + dòng hàng (xuất phiếu)
const db = require('../../core/db');
const { buildSpecKey, legacyAttrs, specsFromBody } = require('../../core/lib/specs');
const { upUnit } = require('../../core/lib/units');
const { guardDelete } = require('../../core/lib/deleteGuard');

exports.list = async (req, res) => {
  try {
    const where = ['so.is_deleted = FALSE'];
    const params = []; let i = 1;
    const { q, status, customer_id } = req.query;
    if (status) { where.push(`so.status = $${i++}`); params.push(status); }
    if (customer_id) { where.push(`so.customer_id = $${i++}`); params.push(customer_id); }
    if (q) { where.push(`(so.order_code ILIKE $${i} OR c.name ILIKE $${i})`); params.push(`%${q}%`); i++; }
    const { rows } = await db.query(`
      SELECT so.*, c.name AS customer_name, c.phone AS customer_phone,
             (SELECT COUNT(*)::int FROM sales_order_items it WHERE it.sales_order_id = so.id) AS item_count,
             (SELECT COALESCE(SUM(it.quantity),0) FROM sales_order_items it WHERE it.sales_order_id = so.id) AS total_qty,
             (SELECT COALESCE(SUM(it.unit_price*it.quantity),0) FROM sales_order_items it WHERE it.sales_order_id = so.id) AS total_amount
      FROM sales_orders so JOIN customers c ON c.id = so.customer_id
      WHERE ${where.join(' AND ')} ORDER BY so.created_at DESC`, params);
    if (!canViewAmounts(req)) rows.forEach((r) => { delete r.total_amount; }); // ẩn tổng tiền nếu không có quyền
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy danh sách đơn hàng' }); }
};

// Tính NVL cho 1 dòng đơn: định mức (theo BOM × SL dòng), tồn kho, cần bổ sung, đã dùng cho đơn.
async function lineMaterials(it) {
  const bom = (await db.query(
    `SELECT id, output_quantity FROM boms WHERE product_id=$1 AND is_deleted=FALSE AND status='Hoạt động' ORDER BY created_at DESC LIMIT 1`,
    [it.product_id])).rows[0];
  if (!bom) return [];
  const factor = Number(it.quantity) / (Number(bom.output_quantity) || 1);
  const lines = (await db.query(
    `SELECT bl.material_id, bl.quantity, bl.unit, p.product_code, p.product_name
     FROM bom_lines bl JOIN products p ON p.id=bl.material_id WHERE bl.bom_id=$1 ORDER BY bl.line_no`, [bom.id])).rows;
  const usedRows = (await db.query(
    `SELECT mu.material_id, COALESCE(SUM(mu.qty),0)::numeric AS used
     FROM production_material_usage mu
     JOIN production_orders po ON po.id = mu.production_order_id
     WHERE po.sales_order_item_id = $1 AND po.is_deleted = FALSE
     GROUP BY mu.material_id`, [it.id])).rows;
  const usedMap = Object.fromEntries(usedRows.map((r) => [r.material_id, Number(r.used)]));
  return Promise.all(lines.map(async (l) => {
    const oh = (await db.query(`SELECT COALESCE(SUM(quantity),0)::numeric AS q FROM inventory_stock WHERE product_id=$1`, [l.material_id])).rows[0].q;
    const required = Number(l.quantity) * factor;
    const onHand = Number(oh);
    const used = usedMap[l.material_id] || 0;
    return {
      material_id: l.material_id, material_code: l.product_code, material_name: l.product_name, unit: l.unit,
      required, on_hand: onHand, to_replenish: Math.max(0, required - onHand), used,
    };
  }));
}

// Quyền xem thông tin tiền của Đơn hàng (đơn giá / thành tiền / tổng đơn)
// Quyền xem tiền ở Đơn hàng — helper dùng chung (gate theo quyền 'orders')
const { canViewAmounts: canViewAmountsBase } = require('../../core/lib/money');
const canViewAmounts = (req) => canViewAmountsBase(req, 'orders');

exports.getById = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT so.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address
      FROM sales_orders so JOIN customers c ON c.id = so.customer_id
      WHERE so.id = $1 AND so.is_deleted = FALSE`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    const items = await db.query(`
      SELECT it.*, p.product_name, p.product_code
      FROM sales_order_items it JOIN products p ON p.id = it.product_id
      WHERE it.sales_order_id = $1 ORDER BY p.product_code`, [req.params.id]);
    const showAmt = canViewAmounts(req);
    const totalAmount = items.rows.reduce((s, it) => s + Number(it.unit_price || 0) * Number(it.quantity || 0), 0);
    // Làm giàu từng dòng: lệnh SX + tag NVL (định mức / tồn / cần bổ sung / đã dùng)
    const enriched = await Promise.all(items.rows.map(async (it) => {
      const orders = (await db.query(`
        SELECT id, order_code, quantity, unit, status FROM production_orders
        WHERE sales_order_item_id = $1 AND is_deleted = FALSE ORDER BY created_at`, [it.id])).rows;
      const materials = await lineMaterials(it);
      const row = { ...it, production_orders: orders, materials };
      if (showAmt) row.amount = Number(it.unit_price || 0) * Number(it.quantity || 0);
      else { delete row.unit_price; row.amount = undefined; } // ẩn giá phía server nếu không có quyền
      return row;
    }));
    res.json({ ...rows[0], items: enriched, ...(showAmt ? { total_amount: totalAmount } : {}) });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết đơn hàng' }); }
};

// Đơn hàng + dòng hàng của 1 khách (chỉ để xem ở màn khách hàng)
exports.byCustomer = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT so.id, so.order_code, so.order_date, so.due_date, so.status
      FROM sales_orders so
      WHERE so.customer_id = $1 AND so.is_deleted = FALSE
      ORDER BY so.created_at DESC`, [req.params.id]);
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const items = await db.query(`
        SELECT it.sales_order_id, it.quantity, it.unit, it.specs, it.attr_size, it.attr_thickness, it.attr_color,
               p.product_code, p.product_name
        FROM sales_order_items it JOIN products p ON p.id = it.product_id
        WHERE it.sales_order_id = ANY($1) ORDER BY p.product_code`, [ids]);
      const byOrder = {};
      items.rows.forEach((it) => { (byOrder[it.sales_order_id] = byOrder[it.sales_order_id] || []).push(it); });
      rows.forEach((r) => { r.items = byOrder[r.id] || []; });
    }
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy đơn hàng của khách' }); }
};

// Đơn hàng của 1 khách CÓ THỂ GIAO: trạng thái đang/đã SX hoặc đang giao dở, và còn SL chưa giao > 0
exports.deliverableOrders = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT so.id, so.order_code, so.order_date, so.due_date, so.status,
             (SELECT COALESCE(SUM(it.quantity),0) FROM sales_order_items it WHERE it.sales_order_id = so.id) AS ordered_total,
             (SELECT COALESCE(SUM(COALESCE(di.actual_quantity, di.quantity)),0) FROM delivery_note_items di
                JOIN delivery_notes dn ON dn.id = di.delivery_note_id
                JOIN sales_order_items it2 ON it2.id = di.sales_order_item_id
                WHERE it2.sales_order_id = so.id AND dn.is_deleted = FALSE AND dn.status NOT IN ('Bản nháp','Đã hủy')) AS delivered_total
      FROM sales_orders so
      WHERE so.customer_id = $1 AND so.is_deleted = FALSE
        AND so.status IN ('Đang sản xuất','Hoàn thành sản xuất','Chuyển hàng 1 phần','Đang vận chuyển')
      ORDER BY so.created_at DESC`, [req.params.id]);
    const data = rows
      .map((r) => ({ ...r, remaining_total: Number(r.ordered_total) - Number(r.delivered_total) }))
      .filter((r) => r.remaining_total > 1e-6);
    res.json({ data });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy đơn giao được' }); }
};

const numOrNull = (v) => (v === '' || v == null ? null : v);

// UPSERT dòng hàng: giữ id cũ (không xóa-tạo lại) để bảo toàn ngày thực tế + liên kết lệnh SX.
async function saveItems(client, orderId, items) {
  const list = (Array.isArray(items) ? items : []).filter((x) => x && x.product_id && x.quantity);
  const keepIds = list.filter((x) => x.id).map((x) => x.id);
  // Xóa các dòng bị bỏ khỏi form (dòng còn giữ thì cập nhật)
  if (keepIds.length) await client.query(`DELETE FROM sales_order_items WHERE sales_order_id = $1 AND id <> ALL($2::uuid[])`, [orderId, keepIds]);
  else await client.query(`DELETE FROM sales_order_items WHERE sales_order_id = $1`, [orderId]);

  for (const it of list) {
    const specs = specsFromBody(it);
    const a = legacyAttrs(specs);
    // Đơn giá: undefined/'' (người dùng không có quyền tiền → không gửi) ⇒ null để COALESCE giữ giá cũ, không ghi đè
    const priceVal = (it.unit_price === undefined || it.unit_price === '' || it.unit_price === null) ? null : Number(it.unit_price);
    const base = [it.product_id, it.quantity, upUnit(it.unit), JSON.stringify(specs), buildSpecKey(specs),
    a.size, a.thickness, a.color, numOrNull(it.core_weight), numOrNull(it.total_weight), it.note || null,
    it.planned_start_date || null, it.planned_end_date || null, it.material_type || null, JSON.stringify(it.mix_ratio || []), priceVal];
    if (it.id) {
      await client.query(
        `UPDATE sales_order_items SET product_id=$1, quantity=$2, unit=$3, specs=$4::jsonb, spec_key=$5,
           attr_size=$6, attr_thickness=$7, attr_color=$8, core_weight=$9, total_weight=$10, note=$11,
           planned_start_date=$12, planned_end_date=$13, material_type=$14, mix_ratio=$15::jsonb,
           unit_price=COALESCE($16, unit_price)
         WHERE id=$17 AND sales_order_id=$18`, [...base, it.id, orderId]);
    } else {
      await client.query(
        `INSERT INTO sales_order_items
           (sales_order_id, product_id, quantity, unit, specs, spec_key, attr_size, attr_thickness, attr_color,
            core_weight, total_weight, note, planned_start_date, planned_end_date, material_type, mix_ratio, unit_price)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,COALESCE($17,0))`,
        [orderId, ...base]);
    }
  }
}

exports.create = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    if (!b.customer_id) return res.status(400).json({ message: 'Vui lòng chọn Khách hàng' });
    if (!Array.isArray(b.items) || !b.items.filter(x => x.product_id && x.quantity).length)
      return res.status(400).json({ message: 'Đơn hàng cần ít nhất 1 dòng hàng hợp lệ' });
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO sales_orders (customer_id, order_date, due_date, status, note, material_type, priority, mix_ratio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.customer_id, b.order_date || new Date(), b.due_date || null, b.status || 'Mới', b.note || null, b.material_type || null, b.priority || 'Trung bình', JSON.stringify(b.mix_ratio || [])]);
    await saveItems(client, rows[0].id, b.items);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi tạo đơn hàng' }); }
  finally { client.release(); }
};

exports.update = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    await client.query('BEGIN');
    const fields = ['customer_id', 'order_date', 'due_date', 'status', 'note', 'material_type', 'priority', 'mix_ratio'];
    const cols = [], vals = []; let i = 1;
    for (const f of fields) if (b[f] !== undefined) { cols.push(`${f} = $${i++}`); vals.push(b[f] === '' ? null : (f === 'mix_ratio' ? JSON.stringify(b[f]) : b[f])); }
    if (cols.length) {
      const r = await client.query(`UPDATE sales_orders SET ${cols.join(', ')} WHERE id = $${i} AND is_deleted = FALSE RETURNING id`, [...vals, req.params.id]);
      if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy đơn hàng' }); }
    }
    if (b.items !== undefined) await saveItems(client, req.params.id, b.items);
    await client.query('COMMIT');
    res.json({ message: 'Đã cập nhật đơn hàng' });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi cập nhật' }); }
  finally { client.release(); }
};

exports.remove = async (req, res) => {
  try {
    const g = await guardDelete('sales_orders', req.params.id, {
      allow: ['Đã hủy'],
      message: 'Không thể xóa đơn hàng đang xử lý. Chỉ xóa được đơn ở trạng thái "Đã hủy" — vui lòng chuyển đơn sang "Đã hủy" trước, rồi mới xóa.',
    });
    if (g.notFound) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    if (g.blocked) return res.status(400).json({ message: g.message });

    const { rowCount } = await db.query(`UPDATE sales_orders SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    res.json({ message: 'Đã xóa đơn hàng' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa' }); }
};
