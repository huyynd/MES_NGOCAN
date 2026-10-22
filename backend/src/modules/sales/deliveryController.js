// backend/controllers/deliveryController.js — Phiếu giao hàng & thanh toán
const db = require('../../core/db');
const { upUnit } = require('../../core/lib/units');
const { guardDelete } = require('../../core/lib/deleteGuard');
const { applyStock, stockErrorResponse, whOutboundOkSql } = require('../../core/lib/stock');
const { nextSlipCode, nextCode } = require('../../core/lib/codes');
const { currentUser } = require('../../core/requestContext');
const { buildSpecKey, specKeyValues } = require('../../core/lib/specs');

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
// "Hôm nay" theo giờ VN (không phụ thuộc timezone của DB/server)
const VN_TODAY_SQL = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
// Ngày giao: phải là ngày hợp lệ và không sau hôm nay (ngày tương lai làm sai tuổi nợ / nợ xấu).
// Trả { error } hoặc { value: 'YYYY-MM-DD' | null }.
async function checkDeliveryDate(client, v) {
  if (v === undefined || v === null || v === '') return { value: null };
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return { error: 'Ngày giao không hợp lệ.' };
  const { future } = (await client.query(`SELECT $1::date > ${VN_TODAY_SQL} AS future`, [s])).rows[0];
  return future ? { error: 'Ngày giao không được sau hôm nay.' } : { value: s };
}
// Thanh toán: khách trả 1 cục qua PHIẾU THANH TOÁN (paymentReceiptController) — tiền tự phân bổ vào
// các phiếu giao cũ nhất trước (core/lib/receivables.js). Phiếu giao không còn ghi nhận thu lẻ.
const { allocateCustomer, debtBlockMessage } = require('../../core/lib/receivables');

// Lịch sử được trả của 1 phiếu: từng phần phân bổ từ phiếu thanh toán (hoặc lần thu cũ trước đây)
async function paymentsOf(conn, noteId) {
  return (await conn.query(`
    SELECT p.*, r.receipt_code, u1.full_name AS created_by_name, u2.full_name AS cancelled_by_name
    FROM delivery_payments p
    LEFT JOIN payment_receipts r ON r.id = p.receipt_id
    LEFT JOIN users u1 ON u1.id = COALESCE(p.created_by, r.created_by)
    LEFT JOIN users u2 ON u2.id = p.cancelled_by
    WHERE p.delivery_note_id = $1 ORDER BY p.pay_date, p.created_at`, [noteId])).rows;
}

// Quyền xem tiền ở Phiếu giao hàng (chặn ở backend — không chỉ ẩn UI) — helper dùng chung
const { canViewAmounts, canEditAmounts, moneyNoteFilter, PAYABLE_NOTE_STATUSES } = require('../../core/lib/money');
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
                       WHERE di.sales_order_item_id = it.id AND ${moneyNoteFilter('dn')}), 0) AS delivered
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
                           AND ${moneyNoteFilter('dn')}), 0) AS delivered,
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
                         AND ${whOutboundOkSql('w', 'lo')}
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
                     WHERE di.sales_order_item_id = it.id AND ${moneyNoteFilter('dn')}), 0) AS delivered
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

// B7: đơn giá dòng phiếu giao khác đơn giá trên đơn hàng → CẢNH BÁO (vẫn cho lưu). Trả mảng chuỗi.
async function priceWarnings(client, items) {
  const list = (Array.isArray(items) ? items : []).filter((x) => x && x.sales_order_item_id && x.unit_price !== undefined && x.unit_price !== '' && x.unit_price !== null);
  if (!list.length) return [];
  const { rows } = await client.query(
    `SELECT it.id, it.unit_price, so.order_code, p.product_name
       FROM sales_order_items it JOIN sales_orders so ON so.id = it.sales_order_id JOIN products p ON p.id = it.product_id
      WHERE it.id = ANY($1::uuid[])`, [list.map((x) => x.sales_order_item_id)]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const vnd = (n) => Number(n || 0).toLocaleString('vi-VN');
  const out = [];
  for (const x of list) {
    const o = byId.get(x.sales_order_item_id);
    if (o && Math.abs(num(x.unit_price) - num(o.unit_price)) > 1e-6) {
      out.push(`${o.product_name} (đơn ${o.order_code}): đơn giá phiếu ${vnd(x.unit_price)}đ khác đơn hàng ${vnd(o.unit_price)}đ`);
    }
  }
  return out;
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
    const dd = await checkDeliveryDate(client, b.delivery_date);
    if (dd.error) return res.status(400).json({ message: dd.error });
    await client.query('BEGIN');
    // Khách nợ vượt hạn mức (app_settings.debt_limit_amount) → không cho tạo phiếu giao mới (kiểm TRONG transaction)
    const blocked = await debtBlockMessage(client, b.customer_id);
    if (blocked) { await client.query('ROLLBACK'); return res.status(400).json({ message: blocked, code: 'DEBT_LIMIT' }); }
    // Đơn ở đầu phiếu = đơn duy nhất của các dòng (phiếu nhiều đơn → NULL); phiếu bán tồn kho → NULL
    const headOrder = await orderIdOfItems(client, b.items);
    const { rows } = await client.query(
      `INSERT INTO delivery_notes (sales_order_id, customer_id, delivery_date, status, note, paid_amount)
       VALUES ($1,$2,COALESCE($3::date, ${VN_TODAY_SQL}),'Bản nháp',$4,0) RETURNING *`, // đã trả = Σ lần thu (ghi nhận sau khi giao), không nhập tay
      [headOrder, b.customer_id, dd.value, b.note || null]);
    const total = await saveItems(client, rows[0].id, b.items);
    await client.query(`UPDATE delivery_notes SET total_amount = $1 WHERE id = $2`, [total, rows[0].id]);
    for (const soId of await orderIdsOfNote(client, rows[0].id)) await updateOrderStatusAfterDelivery(client, soId);
    const warnings = await priceWarnings(client, b.items);
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], total_amount: total, warnings });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi tạo phiếu' }); }
  finally { client.release(); }
};

exports.update = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    await client.query('BEGIN');
    // Chặn đổi trạng thái tự do quanh "Giao hàng" (tránh: đánh dấu đã giao mà không trừ kho, hoặc trừ kho 2 lần)
    const cur = (await client.query(
      `SELECT status, customer_id, delivery_date FROM delivery_notes WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`, [req.params.id])).rows[0];
    if (!cur) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu' }); }
    // Ngày giao: hợp lệ, không sau hôm nay. Đã rời "Bản nháp" → ngày giao đã chốt lúc bấm Giao hàng, không sửa
    // (sửa ngày làm sai tuổi nợ / nợ xấu và thứ tự trừ tiền FIFO). Form luôn gửi kèm ngày → gửi lại đúng ngày cũ thì bỏ qua.
    if (b.delivery_date !== undefined) {
      const dd = await checkDeliveryDate(client, b.delivery_date);
      if (dd.error) { await client.query('ROLLBACK'); return res.status(400).json({ message: dd.error }); }
      if (dd.value === cur.delivery_date) delete b.delivery_date;
      else if (cur.status !== 'Bản nháp') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Phiếu đã giao — không sửa được ngày giao (ngày giao được chốt khi bấm "Giao hàng").' });
      } else b.delivery_date = dd.value || cur.delivery_date;
    }
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
    // Đã giao → khóa khách hàng (công nợ + tiền thanh toán đã phân bổ theo khách).
    // B6: gửi đúng khách cũ (form luôn gửi kèm) thì bỏ qua; đổi sang khách khác → báo lỗi rõ, không im lặng bỏ qua.
    if (b.customer_id !== undefined && cur.status !== 'Bản nháp') {
      if (b.customer_id && b.customer_id !== cur.customer_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Phiếu đã giao — không đổi được khách hàng (công nợ đã ghi theo khách này).' });
      }
      delete b.customer_id;
    }
    // Phiếu nháp ĐỔI sang khách khác = lập phiếu mới cho khách đó → cùng chốt chặn hạn mức nợ như khi tạo
    // (không thì lách được: tạo nháp cho khách sạch rồi đổi sang khách vượt hạn mức). Giữ nguyên khách thì không chặn.
    if (b.customer_id && b.customer_id !== cur.customer_id) {
      const blocked = await debtBlockMessage(client, b.customer_id);
      if (blocked) { await client.query('ROLLBACK'); return res.status(400).json({ message: blocked, code: 'DEBT_LIMIT' }); }
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
    const warnings = b.items !== undefined ? await priceWarnings(client, b.items) : [];
    await client.query('COMMIT');
    res.json({ message: 'Đã cập nhật phiếu', warnings });
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
           AND ${whOutboundOkSql('w', 'lo')}
           AND (NOT $3::boolean OR s.spec_key = $2)
         ORDER BY (s.lot_code = ANY($4::text[])) DESC, (s.spec_key = $2) DESC, (w.warehouse_type = 'TP') DESC, s.id ASC`,
        [l.product_id, l.spec_key, strict, l.own_lots]);
      const avail = (r) => (left.has(rowKey(r)) ? left.get(rowKey(r)) : Number(r.quantity));
      const onHand = stockRows.reduce((s, r) => s + avail(r), 0);
      if (need > onHand + 1e-6) {
        shortages.push({ name: l.product_name + (strict ? ` (đúng thông số ${specKeyValues(l.spec_key).join(', ')})` : ''), unit: l.unit || '', on_hand: onHand, need, lack: need - onHand });
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
    // Vị trí ĐẠI DIỆN ở đầu phiếu = nơi lấy nhiều nhất; vị trí thật của từng phần nằm ở dòng phiếu (K-11)
    const slipLoc = allocations.reduce((m, a) => (a.quantity > m.quantity ? a : m), allocations[0]).location_id;

    await client.query('BEGIN');
    // Hạn mức nợ: nợ + giá trị phiếu này − trả trước > hạn mức → chặn. Kiểm TRƯỚC khi chiếm phiếu (sau khi chiếm,
    // phiếu đã thành "Giao hàng" và bị tính vào nợ). Khóa dòng khách trước khi đọc nợ: 2 phiếu cùng khách giao
    // đồng thời phải xếp hàng, phiếu sau thấy nợ của phiếu trước (không lọt cả hai).
    if (dn.customer_id) {
      await client.query(`SELECT 1 FROM customers WHERE id = $1 FOR UPDATE`, [dn.customer_id]);
      const blocked = await debtBlockMessage(client, dn.customer_id, dn.total_amount);
      if (blocked) { await client.query('ROLLBACK'); return res.status(400).json({ message: blocked, code: 'DEBT_LIMIT' }); }
    }
    // Chống bấm đúp / gọi đồng thời: chỉ MỘT request "chiếm" được phiếu từ Bản nháp (atomic).
    // Request thua sẽ không trừ kho lần 2.
    const claim = await client.query(
      `UPDATE delivery_notes SET status = 'Giao hàng', delivery_date = ${VN_TODAY_SQL}, updated_at = now()
       WHERE id = $1 AND status = 'Bản nháp' AND is_deleted = FALSE RETURNING id`, [req.params.id]);
    if (!claim.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Phiếu đã được giao hoặc đang được xử lý — vui lòng tải lại.' }); }
    // Sinh mã phiếu xuất kho PXK00001… (D1: khóa theo bảng — giao đồng thời không trùng mã)
    const slipCode = await nextSlipCode(client);
    const slip = (await client.query(
      `INSERT INTO outbound_slips (slip_code, purpose, location_id, status, note, confirmed_at, created_by, delivery_note_id)
       VALUES ($1,'Giao hàng cho khách',$2,'Đã xuất',$3, now(), $4, $5) RETURNING id, slip_code`,
      [slipCode, slipLoc, `Giao hàng phiếu ${dn.note_code}${dn.customer_name ? ' · ' + dn.customer_name : ''}`, req.userId || null, dn.id])).rows[0];

    // K-11: mỗi phần đã trừ = 1 dòng phiếu (đúng vị trí + lô + thông số) → truy xuất lô không đứt mắt xích.
    // Trước đây ghi 1 dòng/SP với lô '' và chỉ 1 vị trí đại diện.
    for (const a of allocations) await client.query(
      `INSERT INTO outbound_slip_lines (slip_id, product_id, quantity, unit, lot_code, spec_key, location_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [slip.id, a.product_id, a.quantity, upUnit(a.unit), a.lot_code || '', a.spec_key, a.location_id, null]);

    for (const a of allocations) await applyStock(client, {
      product_id: a.product_id, location_id: a.location_id, delta: -a.quantity, unit: a.unit,
      specs: a.specs, spec_key: a.spec_key, lot_code: a.lot_code,
      clampZero: false, trx_type: 'Xuất', ref_code: slip.slip_code, note: `Giao hàng cho khách (${dn.note_code})`,
    });

    // (trạng thái 'Giao hàng' đã được set atomically ở bước "claim" đầu transaction)
    for (const soId of await orderIdsOfNote(client, dn.id)) await updateOrderStatusAfterDelivery(client, soId);
    // Phiếu vừa phát sinh nợ → trừ ngay vào tiền trả trước (phiếu thanh toán còn dư) của khách, nếu có
    await allocateCustomer(client, dn.customer_id);
    await client.query('COMMIT');
    res.json({ message: `Đã giao hàng — tạo phiếu xuất kho ${slip.slip_code} (${lines.length} dòng) và trừ tồn kho.`, slip_code: slip.slip_code, slip_id: slip.id });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); if (stockErrorResponse(res, err)) return; res.status(500).json({ message: err.detail || 'Lỗi khi giao hàng' }); }
  finally { client.release(); }
};

exports.remove = async (req, res) => {
  try {
    const g = await guardDelete('delivery_notes', req.params.id, {
      allow: ['Bản nháp', 'Đã hủy'],
      message: 'Không thể xóa phiếu đang xử lý / đã thu tiền. Chỉ xóa được phiếu "Bản nháp" hoặc "Đã hủy" — vui lòng chuyển phiếu sang "Đã hủy" trước, rồi mới xóa.',
    });
    if (g.notFound) return res.status(404).json({ message: 'Không tìm thấy phiếu' });
    if (g.blocked) return res.status(400).json({ message: g.message });

    const { rowCount } = await db.query(`UPDATE delivery_notes SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy phiếu' });
    res.json({ message: 'Đã xóa phiếu' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa phiếu' }); }
};

// ── K-12: KHÁCH TRẢ HÀNG ─────────────────────────────────────────────────────
// Nguồn: các giao dịch "Xuất" của phiếu xuất kho sinh ra khi giao phiếu này (mỗi giao dịch = 1 phần đã trừ:
// SP · lô · thông số · vị trí). Trả hàng nhập lại ĐÚNG SP/lô/thông số đó, vào vị trí người nhập chọn
// (mặc định = vị trí đã xuất). Không trả quá phần đã giao trừ phần đã trả trước đó.
// Công nợ / số đã giao của đơn KHÔNG tự đổi (chưa chốt nghiệp vụ).
const RETURNABLE_SQL = `
  SELECT t.id AS trx_id, t.product_id, p.product_code, p.product_name, t.lot_code, t.spec_key, t.specs,
         t.location_id, l.name AS location_name, w.name AS warehouse_name, st.unit,
         t.quantity AS shipped_qty,
         COALESCE((SELECT SUM(ri.quantity) FROM delivery_return_items ri WHERE ri.source_trx_id = t.id), 0) AS returned_qty
  FROM outbound_slips s
  JOIN inventory_transactions t ON t.ref_code = s.slip_code AND t.trx_type = 'Xuất'
  JOIN products p ON p.id = t.product_id
  LEFT JOIN locations l ON l.id = t.location_id
  LEFT JOIN warehouses w ON w.id = l.warehouse_id
  LEFT JOIN LATERAL (SELECT unit FROM outbound_slip_lines sl WHERE sl.slip_id = s.id AND sl.product_id = t.product_id LIMIT 1) st ON TRUE
  WHERE s.delivery_note_id = $1
  ORDER BY p.product_code, t.lot_code, t.created_at`;

// GET /api/deliveries/:id/returns — phần đã giao có thể trả + các phiếu trả đã lập
exports.returnable = async (req, res) => {
  try {
    const lines = (await db.query(RETURNABLE_SQL, [req.params.id])).rows;
    const returns = (await db.query(
      `SELECT r.id, r.return_code, r.return_date, r.note, r.created_by_name, r.created_at,
              COALESCE(SUM(ri.quantity), 0) AS total_qty, COUNT(ri.id)::int AS line_count
         FROM delivery_returns r LEFT JOIN delivery_return_items ri ON ri.return_id = r.id
        WHERE r.delivery_note_id = $1 GROUP BY r.id ORDER BY r.created_at DESC`, [req.params.id])).rows;
    res.json({ lines, returns });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy dữ liệu trả hàng' }); }
};

// POST /api/deliveries/:id/returns  body { return_date, note, items: [{ trx_id, quantity, location_id }] }
exports.createReturn = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { return_date, note } = req.body || {};
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).filter((x) => x && Number(x.quantity) > 0);
    if (!items.length) return res.status(400).json({ message: 'Nhập số lượng trả cho ít nhất 1 dòng.' });
    if (items.some((x) => !Number.isFinite(Number(x.quantity)))) return res.status(400).json({ message: 'Số lượng trả không hợp lệ.' });
    if (items.some((x) => !x.location_id)) return res.status(400).json({ message: 'Vui lòng chọn kho / vị trí nhận hàng trả cho mọi dòng.' });

    await client.query('BEGIN');
    // Khóa phiếu giao: 2 lần trả cùng lúc phải xếp hàng → không trả vượt số đã giao
    const dn = (await client.query(
      `SELECT id, note_code, status FROM delivery_notes WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`, [req.params.id])).rows[0];
    if (!dn) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu giao hàng' }); }
    if (!PAYABLE_NOTE_STATUSES.includes(dn.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Phiếu đang "${dn.status}" — chỉ trả hàng được với phiếu đã giao.` });
    }
    const src = new Map((await client.query(RETURNABLE_SQL, [dn.id])).rows.map((r) => [r.trx_id, r]));
    for (const it of items) {
      const s = src.get(it.trx_id);
      if (!s) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Dòng trả không thuộc phiếu giao này — vui lòng tải lại.' }); }
      const left = Number(s.shipped_qty) - Number(s.returned_qty);
      if (Number(it.quantity) > left + 1e-6) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `${s.product_code} ${s.product_name}${s.lot_code ? ` (lô ${s.lot_code})` : ''}: chỉ còn trả được ${left.toLocaleString('vi-VN')} (đã giao ${Number(s.shipped_qty).toLocaleString('vi-VN')}, đã trả ${Number(s.returned_qty).toLocaleString('vi-VN')}).` });
      }
    }

    const code = await nextCode(client, { table: 'delivery_returns', col: 'return_code', prefix: 'TH', width: 5 });
    const who = currentUser();
    const ret = (await client.query(
      `INSERT INTO delivery_returns (return_code, delivery_note_id, return_date, note, created_by, created_by_name)
       VALUES ($1,$2,COALESCE($3::date, ${VN_TODAY_SQL}),$4,$5,$6) RETURNING id, return_code`,
      [code, dn.id, return_date || null, note || null, who?.id || null, who?.name || null])).rows[0];
    for (const it of items) {
      const s = src.get(it.trx_id);
      const qty = Number(it.quantity);
      // Nhập lại đúng SP · lô · thông số đã giao (applyStock kiểm vị trí còn hoạt động / cho phép nhập)
      await applyStock(client, {
        product_id: s.product_id, location_id: it.location_id, delta: qty, unit: s.unit,
        specs: s.specs || {}, spec_key: s.spec_key, lot_code: s.lot_code || '',
        trx_type: 'Nhập', ref_code: ret.return_code, note: `Khách trả hàng (phiếu giao ${dn.note_code})${note ? ' | ' + note : ''}`,
      });
      await client.query(
        `INSERT INTO delivery_return_items (return_id, source_trx_id, product_id, quantity, unit, lot_code, spec_key, location_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [ret.id, s.trx_id, s.product_id, qty, s.unit || null, s.lot_code || '', s.spec_key, it.location_id]);
    }
    await client.query('COMMIT');
    res.status(201).json({ message: `Đã lập phiếu trả hàng ${ret.return_code} và nhập lại kho.`, return_code: ret.return_code });
  } catch (err) {
    await client.query('ROLLBACK'); console.error(err);
    if (stockErrorResponse(res, err)) return;
    res.status(500).json({ message: err.detail || 'Lỗi khi lập phiếu trả hàng' });
  } finally { client.release(); }
};
