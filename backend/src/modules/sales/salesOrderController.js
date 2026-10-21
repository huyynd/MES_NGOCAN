// backend/controllers/salesOrderController.js — Đơn hàng + dòng hàng (xuất phiếu)
const db = require('../../core/db');
const { buildSpecKey, legacyAttrs, specsFromBody } = require('../../core/lib/specs');
const { upUnit } = require('../../core/lib/units');
const { guardDelete, findDependent } = require('../../core/lib/deleteGuard');

// Trạng thái hợp lệ (khớp CHECK sales_orders_status_check) — chặn status rác → 500
const ORDER_STATUSES = ['Mới', 'Đang sản xuất', 'Hoàn thành sản xuất', 'Chuyển hàng 1 phần', 'Đang vận chuyển',
  'Đã vận chuyển, chưa thanh toán', 'Đã thanh toán', 'Hoàn thành', 'Đã hủy'];

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
const { canViewAmounts: canViewAmountsBase, moneyNoteFilter } = require('../../core/lib/money');
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
                WHERE it2.sales_order_id = so.id AND ${moneyNoteFilter('dn')}) AS delivered_total
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

// Kiểm dòng hàng có chọn sản phẩm: SL là số > 0, đơn giá (nếu gửi) là số ≥ 0. Trả thông báo lỗi hoặc null.
// Đơn giá bỏ trống = NV không có quyền tiền → không gửi, hợp lệ.
function itemsError(items) {
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || !it.product_id) continue;
    const q = Number(it.quantity);
    if (it.quantity === '' || it.quantity == null || !Number.isFinite(q) || q <= 0) return `Dòng ${i + 1}: Số lượng phải là số lớn hơn 0.`;
    if (it.unit_price !== undefined && it.unit_price !== '' && it.unit_price !== null) {
      const p = Number(it.unit_price);
      if (!Number.isFinite(p) || p < 0) return `Dòng ${i + 1}: Đơn giá phải là số không âm.`;
    }
  }
  return null;
}

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
      // LSX kế thừa thông số từ dòng đơn: lệnh CHƯA nhập kho đi theo thông số mới
      // (lệnh đã nhập kho giữ nguyên — đổi giữa chừng sẽ lệch tồn, xem L57 ở productionController).
      await client.query(
        `UPDATE production_orders SET specs=$1::jsonb, spec_key=$2, attr_size=$3, attr_thickness=$4, attr_color=$5,
           group_key = product_id::text || '||' || $2
         WHERE sales_order_item_id=$6 AND is_deleted=FALSE AND COALESCE(posted_qty,0)=0
           AND status NOT IN ('Hoàn thành','Đã hủy') AND spec_key IS DISTINCT FROM $2`,
        [JSON.stringify(specs), buildSpecKey(specs), a.size, a.thickness, a.color, it.id]);
    } else {
      await client.query(
        `INSERT INTO sales_order_items
           (sales_order_id, product_id, quantity, unit, specs, spec_key, attr_size, attr_thickness, attr_color,
            core_weight, total_weight, note, planned_start_date, planned_end_date, material_type, mix_ratio, unit_price)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,COALESCE($17::numeric,0))`,
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
    const itemErr = itemsError(b.items);
    if (itemErr) return res.status(400).json({ message: itemErr });
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO sales_orders (customer_id, order_date, due_date, status, note, material_type, priority, mix_ratio, has_vat)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      // Đơn mới LUÔN "Mới" (bỏ qua b.status) — các trạng thái sau đi theo sản xuất / giao hàng
      [b.customer_id, b.order_date || new Date(), b.due_date || null, 'Mới', b.note || null, b.material_type || null, b.priority || 'Trung bình', JSON.stringify(b.mix_ratio || []),
       b.has_vat !== false]); // mặc định CÓ VAT (như trước); chỉ false khi bỏ tick
    await saveItems(client, rows[0].id, b.items);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: 'Lỗi khi tạo đơn hàng' }); }
  finally { client.release(); }
};

// B1: đơn còn phiếu giao (chưa hủy) hoặc LSX chưa hủy thì KHÔNG được hủy / xóa — trả thông báo hoặc null.
const ORDER_DEPENDENTS = [
  {
    sql: `SELECT DISTINCT dn.note_code AS code FROM delivery_note_items di
          JOIN delivery_notes dn ON dn.id = di.delivery_note_id
          JOIN sales_order_items it ON it.id = di.sales_order_item_id
          WHERE it.sales_order_id = $1 AND dn.is_deleted = FALSE AND dn.status <> 'Đã hủy' ORDER BY 1`,
    message: (rows) => `Đơn đã có phiếu giao (${rows.map((r) => r.code).join(', ')}) — không thể hủy / xóa. Hãy hủy hoặc xóa phiếu giao trước.`,
  },
  {
    sql: `SELECT order_code AS code FROM production_orders
          WHERE sales_order_id = $1 AND is_deleted = FALSE AND status <> 'Đã hủy' ORDER BY 1`,
    message: (rows) => `Đơn đã có lệnh sản xuất chưa hủy (${rows.map((r) => r.code).join(', ')}) — không thể hủy / xóa. Hãy hủy lệnh sản xuất trước.`,
  },
];

exports.update = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    const itemErr = b.items !== undefined ? itemsError(b.items) : null;
    if (itemErr) return res.status(400).json({ message: itemErr });
    if (b.status !== undefined) {
      const cur = (await client.query(`SELECT status FROM sales_orders WHERE id = $1 AND is_deleted = FALSE`, [req.params.id])).rows[0];
      if (!cur) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
      if (b.status !== cur.status) {
        if (!ORDER_STATUSES.includes(b.status)) return res.status(400).json({ message: `Trạng thái "${b.status}" không hợp lệ.` });
        // Đơn đã hủy chỉ được khôi phục về "Mới"
        if (cur.status === 'Đã hủy' && b.status !== 'Mới') return res.status(400).json({ message: 'Đơn đã hủy chỉ có thể khôi phục về trạng thái "Mới".' });
        if (b.status === 'Đã hủy') {
          const dep = await findDependent(req.params.id, ORDER_DEPENDENTS);
          if (dep) return res.status(400).json({ message: dep });
        }
      }
    }
    await client.query('BEGIN');
    const fields = ['customer_id', 'order_date', 'due_date', 'status', 'note', 'material_type', 'priority', 'mix_ratio', 'has_vat'];
    const cols = [], vals = []; let i = 1;
    for (const f of fields) if (b[f] !== undefined) {
      cols.push(`${f} = $${i++}`);
      vals.push(f === 'has_vat' ? b[f] !== false : b[f] === '' ? null : (f === 'mix_ratio' ? JSON.stringify(b[f]) : b[f]));
    }
    if (cols.length) {
      const r = await client.query(`UPDATE sales_orders SET ${cols.join(', ')} WHERE id = $${i} AND is_deleted = FALSE RETURNING id`, [...vals, req.params.id]);
      if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy đơn hàng' }); }
    }
    if (b.items !== undefined) await saveItems(client, req.params.id, b.items);
    await client.query('COMMIT');
    res.json({ message: 'Đã cập nhật đơn hàng' });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: 'Lỗi khi cập nhật' }); }
  finally { client.release(); }
};

exports.remove = async (req, res) => {
  try {
    const g = await guardDelete('sales_orders', req.params.id, {
      allow: ['Đã hủy'],
      message: 'Không thể xóa đơn hàng đang xử lý. Chỉ xóa được đơn ở trạng thái "Đã hủy" — vui lòng chuyển đơn sang "Đã hủy" trước, rồi mới xóa.',
      dependents: ORDER_DEPENDENTS,
    });
    if (g.notFound) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    if (g.blocked) return res.status(400).json({ message: g.message });

    const { rowCount } = await db.query(`UPDATE sales_orders SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    res.json({ message: 'Đã xóa đơn hàng' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa' }); }
};
