// backend/controllers/deliveryController.js — Phiếu giao hàng & thanh toán
const db = require('../../core/db');
const { upUnit } = require('../../core/lib/units');
const { guardDelete } = require('../../core/lib/deleteGuard');
const { applyStock, stockErrorResponse } = require('../../core/lib/stock');
const { buildSpecKey } = require('../../core/lib/specs');

const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);
const EMPTY_SPEC = buildSpecKey({});

// Một phiếu có thể giao NHIỀU đơn của cùng 1 khách: đơn của từng dòng nằm ở delivery_note_items.sales_order_item_id.
// Cột delivery_notes.sales_order_id chỉ còn ý nghĩa tương thích: = đơn duy nhất khi mọi dòng thuộc 1 đơn, ngược lại NULL.
async function orderIdsOfNote(conn, noteId) {
  const { rows } = await conn.query(`
    SELECT DISTINCT it.sales_order_id AS id FROM delivery_note_items di
    JOIN sales_order_items it ON it.id = di.sales_order_item_id
    WHERE di.delivery_note_id = $1
    UNION SELECT sales_order_id FROM delivery_notes WHERE id = $1 AND sales_order_id IS NOT NULL`, [noteId]);
  return rows.map((r) => r.id).filter(Boolean);
}
async function orderIdOfItems(conn, items) {
  const ids = [...new Set((Array.isArray(items) ? items : []).map((x) => x && x.sales_order_item_id).filter(Boolean))];
  if (!ids.length) return null;
  const { rows } = await conn.query(
    `SELECT DISTINCT sales_order_id FROM sales_order_items WHERE id = ANY($1::uuid[])`, [ids]);
  return rows.length === 1 ? rows[0].sales_order_id : null;
}
// Mã các đơn của phiếu (gộp từ dòng) — hiển thị ở danh sách / chi tiết / bản in
const NOTE_ORDER_CODES = (alias) => `COALESCE(
  (SELECT string_agg(DISTINCT so2.order_code, ', ') FROM delivery_note_items di2
     JOIN sales_order_items it2 ON it2.id = di2.sales_order_item_id
     JOIN sales_orders so2 ON so2.id = it2.sales_order_id
   WHERE di2.delivery_note_id = ${alias}.id),
  (SELECT order_code FROM sales_orders WHERE id = ${alias}.sales_order_id))`;

// Bảng chuyển trạng thái hợp lệ cho phiếu giao (state machine).
// - "Giao hàng" KHÔNG nằm trong bảng: chỉ đặt qua nút Giao hàng (ship) — có xuất kho + trừ tồn.
// - "Bản nháp" chỉ được "Đã hủy" (chưa trừ kho) hoặc "Giao hàng" (qua nút). KHÔNG cho sang
//   các trạng thái sau giao để tránh đánh dấu đã bán/đã xuất HĐ mà chưa trừ kho.
// - Sau khi đã giao (đã trừ kho) KHÔNG cho "Đã hủy": chưa có luồng HOÀN KHO nên hủy sẽ mất tồn.
// - "Đã thanh toán 1 phần" / "Đã thanh toán" KHÔNG chọn tay nữa: tự nhảy theo tổng các lần thu (recomputePaid).
const DN_TRANSITIONS = {
  'Bản nháp':             ['Đã hủy'],
  'Giao hàng':            ['Đã xuất hóa đơn', 'Chờ thanh toán'],
  'Đã xuất hóa đơn':      ['Chờ thanh toán'],
  'Chờ thanh toán':       ['Đã xuất hóa đơn'],
  'Đã thanh toán 1 phần': [],
  'Đã thanh toán':        [],
  'Đã hủy':               [],
};
const PAYABLE_STATUSES = ['Giao hàng', 'Đã xuất hóa đơn', 'Chờ thanh toán', 'Đã thanh toán 1 phần', 'Đã thanh toán'];
const PAY_METHODS = ['Tiền mặt', 'Chuyển khoản'];

// Tính lại số đã trả = Σ lần thu chưa hủy, và TỰ đặt trạng thái thanh toán:
//   đã trả ≥ tổng tiền → "Đã thanh toán"; 0 < đã trả < tổng → "Đã thanh toán 1 phần";
//   = 0 → giữ nguyên, trừ khi đang ở trạng thái thanh toán (do hủy lần thu) → về "Chờ thanh toán".
async function recomputePaid(client, noteId) {
  const r = (await client.query(`
    UPDATE delivery_notes d SET paid_amount = sub.s, updated_at = now()
    FROM (SELECT COALESCE(SUM(amount), 0) AS s FROM delivery_payments WHERE delivery_note_id = $1 AND is_cancelled = FALSE) sub
    WHERE d.id = $1 RETURNING d.paid_amount, d.total_amount, d.status`, [noteId])).rows[0];
  if (!r || !PAYABLE_STATUSES.includes(r.status)) return;
  const paid = num(r.paid_amount), total = num(r.total_amount);
  let st = r.status;
  if (paid > 1e-6 && paid >= total - 1e-6) st = 'Đã thanh toán';
  else if (paid > 1e-6) st = 'Đã thanh toán 1 phần';
  else if (['Đã thanh toán 1 phần', 'Đã thanh toán'].includes(r.status)) st = 'Chờ thanh toán';
  if (st !== r.status) await client.query(`UPDATE delivery_notes SET status = $1 WHERE id = $2`, [st, noteId]);
}

// Lịch sử thanh toán của 1 phiếu (kèm tên người thu / người hủy)
async function paymentsOf(conn, noteId) {
  return (await conn.query(`
    SELECT p.*, u1.full_name AS created_by_name, u2.full_name AS cancelled_by_name
    FROM delivery_payments p
    LEFT JOIN users u1 ON u1.id = p.created_by
    LEFT JOIN users u2 ON u2.id = p.cancelled_by
    WHERE p.delivery_note_id = $1 ORDER BY p.pay_date, p.created_at`, [noteId])).rows;
}

// Quyền xem tiền ở Phiếu giao hàng (chặn ở backend — không chỉ ẩn UI) — helper dùng chung
const { canViewAmounts, canEditAmounts } = require('../../core/lib/money');
const stripMoneyItem = (it) => { const { unit_price, amount, ...rest } = it; return rest; };

exports.list = async (req, res) => {
  try {
    const where = ['d.is_deleted = FALSE']; const params = []; let i = 1;
    const { q, status } = req.query;
    if (status) { where.push(`d.status = $${i++}`); params.push(status); }
    if (q)      { where.push(`(d.note_code ILIKE $${i} OR c.name ILIKE $${i})`); params.push(`%${q}%`); i++; }
    const { rows } = await db.query(`
      SELECT d.*, c.name AS customer_name, ${NOTE_ORDER_CODES('d')} AS sales_order_code,
             (SELECT COUNT(*)::int FROM delivery_note_items it WHERE it.delivery_note_id = d.id) AS item_count
      FROM delivery_notes d
      LEFT JOIN customers c ON c.id = d.customer_id
      WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC`, params);
    if (!canViewAmounts(req)) rows.forEach((r) => { delete r.total_amount; delete r.paid_amount; });
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy danh sách phiếu' }); }
};

exports.getById = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT d.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
             ${NOTE_ORDER_CODES('d')} AS sales_order_code
      FROM delivery_notes d
      LEFT JOIN customers c ON c.id = d.customer_id
      WHERE d.id = $1 AND d.is_deleted = FALSE`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy phiếu' });
    // Kèm mã đơn + id đơn của TỪNG dòng (phiếu có thể gồm nhiều đơn)
    const items = await db.query(`
      SELECT di.*, so.order_code AS sales_order_code, so.id AS sales_order_id
      FROM delivery_note_items di
      LEFT JOIN sales_order_items it ON it.id = di.sales_order_item_id
      LEFT JOIN sales_orders so ON so.id = it.sales_order_id
      WHERE di.delivery_note_id = $1 ORDER BY di.line_no`, [req.params.id]);
    const d = rows[0];
    if (!canViewAmounts(req)) {
      delete d.total_amount; delete d.paid_amount;
      return res.json({ ...d, items: items.rows.map(stripMoneyItem) });
    }
    res.json({ ...d, items: items.rows, payments: await paymentsOf(db, req.params.id), can_edit_amounts: canEditAmounts(req) });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết phiếu' }); }
};

// Lấy dòng hàng của 1 đơn để tạo phiếu giao: kèm SL đặt / đã SX / đã giao / còn lại
exports.fromOrder = async (req, res) => {
  try {
    const so = (await db.query(`
      SELECT so.id, so.order_code, so.customer_id, c.name AS customer_name
      FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.id = $1 AND so.is_deleted = FALSE`, [req.params.orderId])).rows[0];
    if (!so) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    const items = (await db.query(`
      SELECT it.id AS sales_order_item_id, it.product_id, p.product_name, it.specs, it.unit, it.unit_price,
             it.quantity AS ordered,
             COALESCE((SELECT SUM(po.posted_qty) FROM production_orders po
                       WHERE po.sales_order_item_id = it.id AND po.is_deleted = FALSE), 0) AS produced,
             COALESCE((SELECT SUM(COALESCE(di.actual_quantity, di.quantity)) FROM delivery_note_items di
                       JOIN delivery_notes dn ON dn.id = di.delivery_note_id
                       WHERE di.sales_order_item_id = it.id AND dn.is_deleted = FALSE AND dn.status NOT IN ('Bản nháp','Đã hủy')), 0) AS delivered
      FROM sales_order_items it JOIN products p ON p.id = it.product_id
      WHERE it.sales_order_id = $1 ORDER BY p.product_code`, [req.params.orderId])).rows;
    const showAmt = canViewAmounts(req);
    res.json({
      sales_order_id: so.id, sales_order_code: so.order_code, customer_id: so.customer_id, customer_name: so.customer_name,
      items: items.map((it) => {
        const ordered = Number(it.ordered) || 0, delivered = Number(it.delivered) || 0;
        const base = { ...it, ordered, produced: Number(it.produced) || 0, delivered, remaining: Math.max(0, ordered - delivered) };
        if (showAmt) base.unit_price = Number(it.unit_price) || 0; else delete base.unit_price;
        return base;
      }),
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy đơn hàng' }); }
};

// GET /api/deliveries/deliverable?customer_id=&exclude_note=
// Các dòng đơn GIAO ĐƯỢC của 1 khách (gom theo đơn) để chọn nhiều đơn vào 1 phiếu. Một dòng chỉ hiện khi:
//   - đơn chưa Hoàn thành / Đã hủy;
//   - còn phải giao  = SL đặt − đã giao > 0;
//   - SX chưa giao   = đã nhập kho (Σ posted_qty các LSX của dòng) − đã giao > 0   (chưa SX → không lên dòng);
//   - còn tồn kho    > 0 (đúng SP + thông số, kho NVL/BTP/TP — nhà máy bán cả hạt nhựa và cuộn).
// SL gợi ý = min(còn phải giao, SX chưa giao, tồn kho) − phần đã nằm ở phiếu NHÁP khác (tránh chọn trùng).
// Đã giao: chỉ tính phiếu đã giao (bỏ Bản nháp / Đã hủy). exclude_note: phiếu đang sửa, không tính là "nháp khác".
exports.deliverable = async (req, res) => {
  try {
    const customerId = req.query.customer_id;
    if (!customerId) return res.status(400).json({ message: 'Thiếu customer_id' });
    const excludeNote = req.query.exclude_note || null;
    const { rows } = await db.query(`
      WITH lines AS (
        SELECT so.id AS sales_order_id, so.order_code, so.status AS order_status, so.due_date,
               it.id AS sales_order_item_id, it.product_id, p.product_code, p.product_name, it.specs,
               COALESCE(NULLIF(it.spec_key, ''), $2) AS spec_key, it.unit, it.unit_price,
               it.quantity AS ordered,
               COALESCE((SELECT SUM(po.posted_qty) FROM production_orders po
                         WHERE po.sales_order_item_id = it.id AND po.is_deleted = FALSE), 0) AS produced,
               COALESCE((SELECT SUM(COALESCE(di.actual_quantity, di.quantity)) FROM delivery_note_items di
                         JOIN delivery_notes dn ON dn.id = di.delivery_note_id
                         WHERE di.sales_order_item_id = it.id AND dn.is_deleted = FALSE
                           AND dn.status NOT IN ('Bản nháp','Đã hủy')), 0) AS delivered,
               COALESCE((SELECT SUM(COALESCE(di.actual_quantity, di.quantity)) FROM delivery_note_items di
                         JOIN delivery_notes dn ON dn.id = di.delivery_note_id
                         WHERE di.sales_order_item_id = it.id AND dn.is_deleted = FALSE AND dn.status = 'Bản nháp'
                           AND ($3::uuid IS NULL OR dn.id <> $3::uuid)), 0) AS in_draft
        FROM sales_orders so
        JOIN sales_order_items it ON it.sales_order_id = so.id
        JOIN products p ON p.id = it.product_id
        WHERE so.customer_id = $1 AND so.is_deleted = FALSE AND so.status NOT IN ('Hoàn thành','Đã hủy')
      )
      SELECT l.*,
             COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s
                       JOIN locations lo ON lo.id = s.location_id
                       JOIN warehouses w ON w.id = lo.warehouse_id
                       WHERE s.product_id = l.product_id AND s.quantity > 0 AND w.warehouse_type IN ('NVL','BTP','TP')
                         AND (l.spec_key = $2 OR s.spec_key = l.spec_key)), 0) AS stock
      FROM lines l
      ORDER BY l.due_date NULLS LAST, l.order_code, l.product_code`, [customerId, EMPTY_SPEC, excludeNote]);
    const showAmt = canViewAmounts(req);
    const orders = new Map();
    for (const r of rows) {
      const ordered = num(r.ordered), produced = num(r.produced), delivered = num(r.delivered);
      const inDraft = num(r.in_draft), stock = num(r.stock);
      const remaining = ordered - delivered, producedLeft = produced - delivered;
      if (remaining <= 1e-6 || producedLeft <= 1e-6 || stock <= 1e-6) continue; // không đủ điều kiện → không lên dòng
      const line = {
        sales_order_item_id: r.sales_order_item_id, product_id: r.product_id, product_code: r.product_code,
        product_name: r.product_name, specs: r.specs || {}, spec_key: r.spec_key, unit: r.unit,
        ordered, produced, delivered, remaining, produced_left: producedLeft, in_draft: inDraft, stock,
        suggested: Math.max(0, Math.min(remaining, producedLeft, stock) - inDraft),
      };
      if (showAmt) line.unit_price = num(r.unit_price);
      if (!orders.has(r.sales_order_id)) orders.set(r.sales_order_id, {
        sales_order_id: r.sales_order_id, order_code: r.order_code, status: r.order_status, due_date: r.due_date, lines: [] });
      orders.get(r.sales_order_id).lines.push(line);
    }
    res.json({ data: [...orders.values()] });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy hàng giao được' }); }
};

// Cập nhật trạng thái ĐƠN HÀNG sau khi giao: còn lại > 0 → "Chuyển hàng 1 phần"; = 0 (tất cả dòng) → "Hoàn thành"
async function updateOrderStatusAfterDelivery(client, salesOrderId) {
  if (!salesOrderId) return;
  const rows = (await client.query(`
    SELECT it.quantity AS ordered,
           COALESCE((SELECT SUM(COALESCE(di.actual_quantity, di.quantity)) FROM delivery_note_items di
                     JOIN delivery_notes dn ON dn.id = di.delivery_note_id
                     WHERE di.sales_order_item_id = it.id AND dn.is_deleted = FALSE AND dn.status NOT IN ('Bản nháp','Đã hủy')), 0) AS delivered
    FROM sales_order_items it WHERE it.sales_order_id = $1`, [salesOrderId])).rows;
  if (!rows.length) return;
  const anyDelivered = rows.some((r) => Number(r.delivered) > 0);
  if (!anyDelivered) return; // chưa giao gì thì không đổi trạng thái
  const allDone = rows.every((r) => Number(r.delivered) >= Number(r.ordered) - 1e-6);
  const newStatus = allDone ? 'Hoàn thành' : 'Chuyển hàng 1 phần';
  await client.query(
    `UPDATE sales_orders SET status = $1, updated_at = now() WHERE id = $2 AND is_deleted = FALSE AND status <> 'Đã hủy'`,
    [newStatus, salesOrderId]);
}

async function saveItems(client, noteId, items) {
  await client.query('DELETE FROM delivery_note_items WHERE delivery_note_id = $1', [noteId]);
  const list = (Array.isArray(items) ? items : []).filter((x) => x && (x.product_id || x.product_name));
  // Tra tên + đơn vị sản phẩm nếu dòng chưa có (đảm bảo NỘI DUNG luôn có dữ liệu)
  const ids = [...new Set(list.filter((x) => x.product_id).map((x) => x.product_id))];
  const pmap = {};
  if (ids.length) {
    const pr = await client.query(`SELECT id, product_name, unit FROM products WHERE id = ANY($1::uuid[])`, [ids]);
    pr.rows.forEach((p) => { pmap[p.id] = p; });
  }
  let n = 1, total = 0;
  for (const it of list) {
    const p = it.product_id ? pmap[it.product_id] : null;
    const qty = num(it.quantity), price = num(it.unit_price);
    const actQty = it.actual_quantity === '' || it.actual_quantity == null ? null : num(it.actual_quantity);
    const amount = (actQty !== null ? actQty : qty) * price; total += amount;
    await client.query(
      `INSERT INTO delivery_note_items (delivery_note_id, product_id, product_name, specs, quantity, unit, unit_price, amount, line_no, actual_quantity, sales_order_item_id)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)`,
      [noteId, it.product_id || null, it.product_name || (p && p.product_name) || null, JSON.stringify(it.specs || {}),
       qty, upUnit(it.unit || (p && p.unit)), price, amount, n++, actQty, it.sales_order_item_id || null]);
  }
  return total;
}

exports.create = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    if (!b.customer_id) return res.status(400).json({ message: 'Vui lòng chọn Khách hàng' });
    // Phiếu mới LUÔN là "Bản nháp" (bỏ qua b.status gửi lên) — mọi trạng thái sau đó phải đi
    // qua đúng luồng: "Giao hàng" bằng nút ship (trừ kho), rồi mới tới hóa đơn/thanh toán.
    await client.query('BEGIN');
    // Đơn ở đầu phiếu = đơn duy nhất của các dòng (phiếu nhiều đơn → NULL); phiếu bán tồn kho → NULL
    const headOrder = await orderIdOfItems(client, b.items);
    const { rows } = await client.query(
      `INSERT INTO delivery_notes (sales_order_id, customer_id, delivery_date, status, note, paid_amount)
       VALUES ($1,$2,$3,'Bản nháp',$4,0) RETURNING *`, // đã trả = Σ lần thu (ghi nhận sau khi giao), không nhập tay
      [headOrder, b.customer_id, b.delivery_date || new Date(), b.note || null]);
    const total = await saveItems(client, rows[0].id, b.items);
    await client.query(`UPDATE delivery_notes SET total_amount = $1 WHERE id = $2`, [total, rows[0].id]);
    for (const soId of await orderIdsOfNote(client, rows[0].id)) await updateOrderStatusAfterDelivery(client, soId);
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], total_amount: total });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi tạo phiếu' }); }
  finally { client.release(); }
};

exports.update = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    await client.query('BEGIN');
    // Chặn đổi trạng thái tự do quanh "Giao hàng" (tránh: đánh dấu đã giao mà không trừ kho, hoặc trừ kho 2 lần)
    const cur = (await client.query(`SELECT status FROM delivery_notes WHERE id = $1 AND is_deleted = FALSE`, [req.params.id])).rows[0];
    if (!cur) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu' }); }
    if (b.status !== undefined && b.status !== cur.status) {
      if (b.status === 'Giao hàng') { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Không đặt trạng thái "Giao hàng" thủ công — hãy dùng nút "Giao hàng" để xuất kho + trừ tồn.' }); }
      const allowed = DN_TRANSITIONS[cur.status] || [];
      if (!allowed.includes(b.status)) { await client.query('ROLLBACK'); return res.status(400).json({ message: `Không thể chuyển trạng thái "${cur.status}" → "${b.status}".` }); }
    }
    // Chỉ cho sửa DÒNG HÀNG khi còn "Bản nháp": sau khi đã giao, dòng hàng đã quyết định lượng trừ kho → khóa lại.
    if (b.items !== undefined && cur.status !== 'Bản nháp') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Phiếu đã rời "Bản nháp" — không thể sửa dòng hàng (đã chốt theo lượng xuất kho).' });
    }
    // Đơn ở đầu phiếu tính lại từ dòng khi dòng thay đổi (không lấy từ client)
    const ordersBefore = await orderIdsOfNote(client, req.params.id);
    const fields = ['customer_id', 'delivery_date', 'status', 'note'];
    const cols = [], vals = []; let i = 1;
    for (const f of fields) if (b[f] !== undefined) { cols.push(`${f} = $${i++}`); vals.push(b[f] === '' ? null : b[f]); }
    if (b.items !== undefined) { cols.push(`sales_order_id = $${i++}`); vals.push(await orderIdOfItems(client, b.items)); }
    // paid_amount KHÔNG nhận từ client nữa — chỉ tính lại từ lịch sử thanh toán (recomputePaid)
    cols.push(`updated_at = now()`);
    const r = await client.query(`UPDATE delivery_notes SET ${cols.join(', ')} WHERE id = $${i} AND is_deleted = FALSE RETURNING id`, [...vals, req.params.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu' }); }
    if (b.items !== undefined) {
      const total = await saveItems(client, req.params.id, b.items);
      await client.query(`UPDATE delivery_notes SET total_amount = $1 WHERE id = $2`, [total, req.params.id]);
    }
    // Cập nhật trạng thái MỌI đơn liên quan (kể cả đơn vừa bị bỏ khỏi phiếu)
    const ordersAfter = await orderIdsOfNote(client, req.params.id);
    for (const soId of new Set([...ordersBefore, ...ordersAfter])) await updateOrderStatusAfterDelivery(client, soId);
    await client.query('COMMIT');
    res.json({ message: 'Đã cập nhật phiếu' });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi cập nhật phiếu' }); }
  finally { client.release(); }
};

// POST /api/deliveries/:id/ship — XÁC NHẬN GIAO HÀNG
// Tự tạo 1 phiếu xuất kho (mục đích "Giao hàng cho khách") từ Kho Thành phẩm, trừ tồn (FIFO),
// chặn nếu tồn TP không đủ, rồi chuyển phiếu giao sang trạng thái "Giao hàng".
exports.ship = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const dn = (await client.query(
      `SELECT d.*, c.name AS customer_name, so.order_code AS sales_order_code
       FROM delivery_notes d
       LEFT JOIN customers c ON c.id = d.customer_id
       LEFT JOIN sales_orders so ON so.id = d.sales_order_id
       WHERE d.id = $1 AND d.is_deleted = FALSE`, [req.params.id])).rows[0];
    if (!dn) return res.status(404).json({ message: 'Không tìm thấy phiếu giao hàng' });
    if (dn.status === 'Đã hủy') return res.status(400).json({ message: 'Phiếu đã hủy, không thể giao hàng.' });
    if (dn.status !== 'Bản nháp') return res.status(400).json({ message: `Phiếu đã ở trạng thái "${dn.status}" — chỉ giao hàng được từ "Bản nháp".` });

    // Kèm mã các LSX của dòng đơn → "lô của chính đơn" (lô TP/BTP mang mã LSX đã nhập ra nó)
    const items = (await client.query(
      `SELECT di.product_id, di.product_name, di.specs, di.unit, di.sales_order_item_id,
              COALESCE(di.actual_quantity, di.quantity) AS qty,
              COALESCE((SELECT array_agg(po.order_code) FROM production_orders po
                        WHERE po.sales_order_item_id = di.sales_order_item_id AND po.is_deleted = FALSE), '{}') AS own_lots
       FROM delivery_note_items di WHERE di.delivery_note_id = $1`, [req.params.id])).rows;
    // Gộp theo (sản phẩm + thông số + dòng đơn) để trừ ĐÚNG biến thể và ưu tiên đúng lô của từng đơn;
    // số lượng = COALESCE(SL thực, SL giao). Dòng bán tồn kho (không theo đơn) gộp theo SP + thông số.
    const byKey = new Map();
    for (const it of items) {
      if (!it.product_id) return res.status(400).json({ message: `Dòng "${it.product_name || ''}" chưa gắn sản phẩm trong kho — không thể xuất kho.` });
      const q = Number(it.qty) || 0;
      if (q <= 0) continue;
      const sk = buildSpecKey(it.specs || {});
      const key = `${it.product_id}|${sk}|${it.sales_order_item_id || ''}`;
      const cur = byKey.get(key) || { product_id: it.product_id, product_name: it.product_name, unit: it.unit, spec_key: sk, own_lots: it.own_lots || [], qty: 0 };
      cur.qty += q; byKey.set(key, cur);
    }
    const lines = [...byKey.values()];
    if (!lines.length) return res.status(400).json({ message: 'Phiếu chưa có dòng hàng có số lượng giao > 0.' });

    // Phân bổ FIFO + kiểm tra đủ tồn trước khi trừ (chỉ lấy ở NVL/BTP/TP, ưu tiên kho Thành phẩm).
    // M10: dòng CÓ thông số (giao theo đơn) → chỉ lấy đúng spec_key, thiếu thì báo thiếu
    //      (trước đây chỉ ưu tiên rồi lấy bù biến thể khác → giao nhầm màu/kích thước).
    //      Dòng KHÔNG thông số (bán hàng tồn kho không theo đơn) → lấy mọi biến thể như cũ.
    // M11: theo dõi lượng còn lại của từng dòng tồn (`left`) để các dòng phiếu không dùng trùng
    //      một dòng tồn; xử lý dòng có thông số trước để dòng "bất kỳ" không lấy mất hàng của chúng.
    // Thứ tự xử lý: dòng có thông số trước; trong đó dòng CÓ lô riêng (theo đơn) trước, để lô của đơn nào
    // được chính đơn đó lấy trước, không bị dòng khác lấy mất.
    lines.sort((a, b) => (Number(a.spec_key === EMPTY_SPEC) - Number(b.spec_key === EMPTY_SPEC))
      || (Number(!a.own_lots.length) - Number(!b.own_lots.length)));
    const left = new Map(); // `${location_id}|${lot_code}|${spec_key}` → lượng còn lại sau các dòng trước
    const rowKey = (r) => `${r.location_id}|${r.lot_code || ''}|${r.spec_key}`;
    const shortages = [], allocations = [];
    for (const l of lines) {
      const need = Number(l.qty);
      const strict = l.spec_key !== EMPTY_SPEC;
      const { rows: stockRows } = await client.query(
        `SELECT s.location_id, s.lot_code, s.quantity, s.unit, s.spec_key, s.specs
         FROM inventory_stock s
         JOIN locations lo ON lo.id = s.location_id
         JOIN warehouses w ON w.id = lo.warehouse_id
         WHERE s.product_id = $1 AND s.quantity > 0 AND w.warehouse_type IN ('NVL','BTP','TP')
           AND (NOT $3::boolean OR s.spec_key = $2)
         ORDER BY (s.lot_code = ANY($4::text[])) DESC, (s.spec_key = $2) DESC, (w.warehouse_type = 'TP') DESC, s.id ASC`,
        [l.product_id, l.spec_key, strict, l.own_lots]);
      const avail = (r) => (left.has(rowKey(r)) ? left.get(rowKey(r)) : Number(r.quantity));
      const onHand = stockRows.reduce((s, r) => s + avail(r), 0);
      if (need > onHand + 1e-6) {
        shortages.push({ name: l.product_name + (strict ? ` (đúng thông số ${l.spec_key.split('|').filter(Boolean).join(', ')})` : ''), unit: l.unit || '', on_hand: onHand, need, lack: need - onHand });
      } else {
        let remain = need;
        for (const sr of stockRows) {
          if (remain <= 1e-9) break;
          const a = avail(sr);
          if (a <= 1e-9) continue;
          const take = Math.min(remain, a);
          left.set(rowKey(sr), a - take);
          allocations.push({ product_id: l.product_id, location_id: sr.location_id, lot_code: sr.lot_code || '', spec_key: sr.spec_key, specs: sr.specs || {}, quantity: take, unit: l.unit || sr.unit });
          remain -= take;
        }
      }
    }
    if (shortages.length) {
      const msg = 'Không đủ tồn kho để giao — vui lòng sản xuất/nhập kho trước:\n' +
        shortages.map((x) => `• ${x.name}: tồn ${x.on_hand} ${x.unit}, cần giao ${x.need} ${x.unit} → thiếu ${x.lack} ${x.unit}`).join('\n');
      return res.status(400).json({ message: msg, shortages });
    }
    const slipLoc = allocations[0].location_id; // kho đại diện cho phiếu xuất (có thể gồm nhiều kho)

    await client.query('BEGIN');
    // Chống bấm đúp / gọi đồng thời: chỉ MỘT request "chiếm" được phiếu từ Bản nháp (atomic).
    // Request thua sẽ không trừ kho lần 2.
    const claim = await client.query(
      `UPDATE delivery_notes SET status = 'Giao hàng', updated_at = now()
       WHERE id = $1 AND status = 'Bản nháp' AND is_deleted = FALSE RETURNING id`, [req.params.id]);
    if (!claim.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Phiếu đã được giao hoặc đang được xử lý — vui lòng tải lại.' }); }
    // Sinh mã phiếu xuất kho PXK00001…
    const slipCode = (await client.query(
      `SELECT 'PXK' || LPAD((COALESCE(MAX(NULLIF(regexp_replace(slip_code,'\\D','','g'),''))::int,0)+1)::text,5,'0') AS code
       FROM outbound_slips WHERE slip_code ~ '^PXK[0-9]+$'`)).rows[0].code;
    const slip = (await client.query(
      `INSERT INTO outbound_slips (slip_code, purpose, location_id, status, note, confirmed_at, created_by)
       VALUES ($1,'Giao hàng cho khách',$2,'Đã xuất',$3, now(), $4) RETURNING id, slip_code`,
      [slipCode, slipLoc, `Giao hàng phiếu ${dn.note_code}${dn.customer_name ? ' · ' + dn.customer_name : ''}`, req.userId || null])).rows[0];

    for (const l of lines) await client.query(
      `INSERT INTO outbound_slip_lines (slip_id, product_id, quantity, unit, lot_code, note) VALUES ($1,$2,$3,$4,'',$5)`,
      [slip.id, l.product_id, Number(l.qty), upUnit(l.unit), null]);

    for (const a of allocations) await applyStock(client, {
      product_id: a.product_id, location_id: a.location_id, delta: -a.quantity, unit: a.unit,
      specs: a.specs, spec_key: a.spec_key, lot_code: a.lot_code,
      clampZero: false, trx_type: 'Xuất', ref_code: slip.slip_code, note: `Giao hàng cho khách (${dn.note_code})`,
    });

    // (trạng thái 'Giao hàng' đã được set atomically ở bước "claim" đầu transaction)
    for (const soId of await orderIdsOfNote(client, dn.id)) await updateOrderStatusAfterDelivery(client, soId);
    await client.query('COMMIT');
    res.json({ message: `Đã giao hàng — tạo phiếu xuất kho ${slip.slip_code} (${lines.length} dòng) và trừ tồn kho.`, slip_code: slip.slip_code, slip_id: slip.id });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); if (stockErrorResponse(res, err)) return; res.status(500).json({ message: err.detail || 'Lỗi khi giao hàng' }); }
  finally { client.release(); }
};

exports.remove = async (req, res) => {
  try {
    const g = await guardDelete('delivery_notes', req.params.id, {
      allow: ['Đã hủy'],
      message: 'Không thể xóa phiếu đang xử lý / đã thu tiền. Chỉ xóa được phiếu ở trạng thái "Đã hủy" — vui lòng chuyển phiếu sang "Đã hủy" trước, rồi mới xóa.',
    });
    if (g.notFound) return res.status(404).json({ message: 'Không tìm thấy phiếu' });
    if (g.blocked) return res.status(400).json({ message: g.message });

    const { rowCount } = await db.query(`UPDATE delivery_notes SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy phiếu' });
    res.json({ message: 'Đã xóa phiếu' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa phiếu' }); }
};

// POST /api/deliveries/:id/payments — GHI NHẬN 1 lần thanh toán { pay_date, amount, method, note }
// Chỉ phiếu đã giao (không Bản nháp / Đã hủy); chặn trả vượt tổng tiền; tự tính lại đã trả + trạng thái.
exports.addPayment = async (req, res) => {
  if (!canEditAmounts(req)) return res.status(403).json({ message: 'Bạn không có quyền ghi nhận thanh toán.' });
  const client = await db.pool.connect();
  try {
    const b = req.body || {};
    const amount = num(b.amount);
    if (!(amount > 0)) return res.status(400).json({ message: 'Số tiền thanh toán phải lớn hơn 0.' });
    const method = PAY_METHODS.includes(b.method) ? b.method : null;
    if (!method) return res.status(400).json({ message: `Hình thức thanh toán phải là: ${PAY_METHODS.join(' / ')}.` });
    await client.query('BEGIN');
    // Khóa phiếu khi ghi nhận → 2 người cùng ghi không vượt tổng
    const dn = (await client.query(
      `SELECT id, status, total_amount, paid_amount FROM delivery_notes WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
      [req.params.id])).rows[0];
    if (!dn) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu' }); }
    if (!PAYABLE_STATUSES.includes(dn.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Phiếu đang "${dn.status}" — chỉ ghi nhận thanh toán sau khi đã giao hàng.` });
    }
    const debt = num(dn.total_amount) - num(dn.paid_amount);
    if (amount > debt + 1e-6) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Số tiền ${amount.toLocaleString('vi-VN')} đ vượt công nợ còn lại ${Math.max(0, debt).toLocaleString('vi-VN')} đ của phiếu.` });
    }
    await client.query(
      `INSERT INTO delivery_payments (delivery_note_id, pay_date, amount, method, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [dn.id, b.pay_date || new Date(), amount, method, b.note || null, req.userId || null]);
    await recomputePaid(client, dn.id);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Đã ghi nhận thanh toán', payments: await paymentsOf(db, dn.id) });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi ghi nhận thanh toán' }); }
  finally { client.release(); }
};

// POST /api/deliveries/payments/:pid/cancel — HỦY 1 lần thu (thu nhầm) { reason } — giữ dấu vết, không xóa
exports.cancelPayment = async (req, res) => {
  if (!canEditAmounts(req)) return res.status(403).json({ message: 'Bạn không có quyền hủy thanh toán.' });
  const client = await db.pool.connect();
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ message: 'Vui lòng nhập lý do hủy lần thu.' });
    await client.query('BEGIN');
    const p = (await client.query(
      `UPDATE delivery_payments SET is_cancelled = TRUE, cancelled_by = $2, cancelled_at = now(), cancel_reason = $3
       WHERE id = $1 AND is_cancelled = FALSE RETURNING delivery_note_id`, [req.params.pid, req.userId || null, reason])).rows[0];
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy lần thu (hoặc đã hủy trước đó).' }); }
    await client.query(`SELECT id FROM delivery_notes WHERE id = $1 FOR UPDATE`, [p.delivery_note_id]);
    await recomputePaid(client, p.delivery_note_id);
    await client.query('COMMIT');
    res.json({ message: 'Đã hủy lần thu', payments: await paymentsOf(db, p.delivery_note_id) });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi hủy lần thu' }); }
  finally { client.release(); }
};
