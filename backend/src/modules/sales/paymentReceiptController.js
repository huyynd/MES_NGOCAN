// backend/src/modules/sales/paymentReceiptController.js — PHIẾU THANH TOÁN & BÁO CÁO CÔNG NỢ
//
// Khách trả 1 cục (không theo từng phiếu giao). Lưu phiếu → tiền tự trừ vào phiếu giao còn nợ CŨ NHẤT TRƯỚC;
// phiếu giao đủ tiền tự chuyển "Đã thanh toán". Trả dư = tiền trả trước, tự trừ khi có phiếu giao mới.
// Quyền: xem = canViewAmounts, ghi/hủy = canEditAmounts (quyền tiền của Phiếu giao hàng).
const db = require('../../core/db');
const { canViewAmounts, canEditAmounts } = require('../../core/lib/money');
const { PAYABLE_STATUSES, debtAgeSql, allocateCustomer, rebuildCustomer, customerDebts } = require('../../core/lib/receivables');

const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);
const PAY_METHODS = ['Tiền mặt', 'Chuyển khoản'];
const noView = (res) => res.status(403).json({ message: 'Bạn không có quyền xem số liệu tiền / công nợ.' });
const noEdit = (res) => res.status(403).json({ message: 'Bạn không có quyền ghi nhận / hủy thanh toán.' });

// Danh sách phiếu thanh toán kèm số đã trừ vào phiếu giao + tiền trả trước còn lại
const RECEIPT_SELECT = `
  SELECT r.*, c.name AS customer_name, c.customer_code,
         u1.full_name AS created_by_name, u2.full_name AS cancelled_by_name,
         COALESCE(a.allocated, 0) AS allocated,
         CASE WHEN r.is_cancelled THEN 0 ELSE r.amount - COALESCE(a.allocated, 0) END AS unallocated,
         COALESCE(a.note_count, 0)::int AS note_count,
         (SELECT string_agg(so.order_code, ', ' ORDER BY so.order_code) FROM sales_orders so
           WHERE so.id = ANY(r.sales_order_ids)) AS order_codes
  FROM payment_receipts r
  LEFT JOIN customers c ON c.id = r.customer_id
  LEFT JOIN users u1 ON u1.id = r.created_by
  LEFT JOIN users u2 ON u2.id = r.cancelled_by
  LEFT JOIN (SELECT receipt_id, SUM(amount) AS allocated, COUNT(DISTINCT delivery_note_id) AS note_count
             FROM delivery_payments WHERE receipt_id IS NOT NULL AND is_cancelled = FALSE
             GROUP BY receipt_id) a ON a.receipt_id = r.id`;

// Phiếu giao được phiếu thanh toán này trả (từng phần phân bổ)
async function allocationsOf(conn, receiptId) {
  return (await conn.query(`
    SELECT p.id, p.amount, p.is_cancelled, p.cancel_reason, d.id AS delivery_note_id, d.note_code,
           d.delivery_date, d.total_amount, d.paid_amount, d.status
    FROM delivery_payments p JOIN delivery_notes d ON d.id = p.delivery_note_id
    WHERE p.receipt_id = $1 ORDER BY d.delivery_date, d.created_at`, [receiptId])).rows;
}

// Kiểm tra + chuẩn hóa dữ liệu phiếu (dùng cho tạo & sửa)
function cleanBody(b, { forCreate }) {
  const out = {
    pay_date: b.pay_date || null,
    invoice_date: b.invoice_date || null,
    invoice_no: (b.invoice_no || '').trim() || null,
    payer_name: (b.payer_name || '').trim() || null,
    method: b.method,
    content: (b.content || '').trim() || null,
    sales_order_ids: Array.isArray(b.sales_order_ids) ? b.sales_order_ids.filter(Boolean) : [],
  };
  if (!out.pay_date) return { error: 'Vui lòng nhập Ngày thanh toán.' };
  if (!PAY_METHODS.includes(out.method)) return { error: `Hình thức thanh toán phải là: ${PAY_METHODS.join(' / ')}.` };
  if (forCreate) {
    out.customer_id = b.customer_id;
    out.amount = Math.round(num(b.amount) * 100) / 100;
    if (!out.customer_id) return { error: 'Vui lòng chọn Khách hàng.' };
    if (!(out.amount > 0)) return { error: 'Số tiền thanh toán phải lớn hơn 0.' };
  }
  return { data: out };
}

// C1: kiểm dữ liệu cần tra DB — ngày hợp lệ & không sau hôm nay (giờ VN), khách tồn tại,
// đơn hàng gắn kèm phải là đơn của CHÍNH khách đó. Trả thông báo lỗi hoặc null.
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s).slice(0, 10)) && !Number.isNaN(Date.parse(String(s).slice(0, 10)));
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
async function refsError(conn, b, customerId) {
  if (!isYmd(b.pay_date)) return 'Ngày thanh toán không hợp lệ.';
  if (b.invoice_date && !isYmd(b.invoice_date)) return 'Ngày hóa đơn không hợp lệ.';
  const { future } = (await conn.query(
    `SELECT $1::date > (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS future`, [String(b.pay_date).slice(0, 10)])).rows[0];
  if (future) return 'Ngày thanh toán không được sau hôm nay.';
  if (!isUuid(customerId)) return 'Khách hàng không tồn tại.';
  const c = (await conn.query(`SELECT 1 FROM customers WHERE id = $1 AND is_deleted = FALSE`, [customerId])).rowCount;
  if (!c) return 'Khách hàng không tồn tại.';
  if (b.sales_order_ids.length) {
    if (!b.sales_order_ids.every(isUuid)) return 'Đơn hàng gắn kèm không hợp lệ.';
    const bad = (await conn.query(
      `SELECT x.id, so.order_code FROM unnest($1::uuid[]) AS x(id)
         LEFT JOIN sales_orders so ON so.id = x.id AND so.is_deleted = FALSE
        WHERE so.id IS NULL OR so.customer_id <> $2`, [b.sales_order_ids, customerId])).rows;
    if (bad.length) return `Đơn hàng ${bad.map((r) => r.order_code || '(không tồn tại)').join(', ')} không phải đơn của khách này.`;
  }
  return null;
}

exports.list = async (req, res) => {
  if (!canViewAmounts(req)) return noView(res);
  try {
    const where = ['TRUE']; const params = [];
    if (req.query.customer_id) { params.push(req.query.customer_id); where.push(`r.customer_id = $${params.length}`); }
    const { rows } = await db.query(`${RECEIPT_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.pay_date DESC, r.created_at DESC`, params);
    res.json({ data: rows, can_edit_amounts: canEditAmounts(req) });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy danh sách phiếu thanh toán' }); }
};

exports.getById = async (req, res) => {
  if (!canViewAmounts(req)) return noView(res);
  try {
    const r = (await db.query(`${RECEIPT_SELECT} WHERE r.id = $1`, [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ message: 'Không tìm thấy phiếu thanh toán' });
    res.json({ ...r, allocations: await allocationsOf(db, r.id), can_edit_amounts: canEditAmounts(req) });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy phiếu thanh toán' }); }
};

exports.create = async (req, res) => {
  if (!canEditAmounts(req)) return noEdit(res);
  const v = cleanBody(req.body || {}, { forCreate: true });
  if (v.error) return res.status(400).json({ message: v.error });
  const b = v.data;
  const client = await db.pool.connect();
  try {
    const refErr = await refsError(client, b, b.customer_id);
    if (refErr) return res.status(400).json({ message: refErr });
    await client.query('BEGIN');
    const r = (await client.query(
      `INSERT INTO payment_receipts (customer_id, pay_date, invoice_date, invoice_no, payer_name, method, content, amount, sales_order_ids, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10) RETURNING id, receipt_code`,
      [b.customer_id, b.pay_date, b.invoice_date, b.invoice_no, b.payer_name, b.method, b.content, b.amount, b.sales_order_ids, req.userId || null])).rows[0];
    // Trừ vào các phiếu giao còn nợ, cũ nhất trước
    await allocateCustomer(client, b.customer_id);
    await client.query('COMMIT');
    const full = (await db.query(`${RECEIPT_SELECT} WHERE r.id = $1`, [r.id])).rows[0];
    const allocations = await allocationsOf(db, r.id);
    const paidOff = allocations.filter((a) => a.status === 'Đã thanh toán').map((a) => a.note_code);
    let msg = `Đã lưu phiếu ${r.receipt_code}`;
    if (allocations.length) msg += ` — trừ vào ${allocations.length} phiếu giao`;
    if (paidOff.length) msg += `, ${paidOff.length} phiếu đã thanh toán đủ`;
    if (num(full.unallocated) > 0) msg += `. Dư ${Math.round(num(full.unallocated)).toLocaleString('vi-VN')} đ giữ làm tiền trả trước`;
    res.status(201).json({ message: msg, ...full, allocations });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi lưu phiếu thanh toán' }); }
  finally { client.release(); }
};

// Sửa thông tin mô tả (ngày, hóa đơn, người trả, hình thức, nội dung, đơn hàng).
// KHÔNG sửa Khách hàng / Số tiền — đã phân bổ vào phiếu giao; sai thì Hủy phiếu và lập lại.
exports.update = async (req, res) => {
  if (!canEditAmounts(req)) return noEdit(res);
  const v = cleanBody(req.body || {}, { forCreate: false });
  if (v.error) return res.status(400).json({ message: v.error });
  const b = v.data;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query(
      `SELECT customer_id, pay_date::text AS pay_date FROM payment_receipts WHERE id = $1 AND is_cancelled = FALSE FOR UPDATE`,
      [req.params.id])).rows[0];
    if (!cur) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu (hoặc phiếu đã hủy).' }); }
    const refErr = await refsError(client, b, cur.customer_id);
    if (refErr) { await client.query('ROLLBACK'); return res.status(400).json({ message: refErr }); }
    await client.query(
      `UPDATE payment_receipts SET pay_date=$2, invoice_date=$3, invoice_no=$4, payer_name=$5, method=$6, content=$7,
              sales_order_ids=$8::uuid[], updated_at=now()
       WHERE id = $1`,
      [req.params.id, b.pay_date, b.invoice_date, b.invoice_no, b.payer_name, b.method, b.content, b.sales_order_ids]);
    // Đổi ngày thanh toán → thứ tự trừ nợ (FIFO) thay đổi → phân bổ lại cho khách
    if (String(b.pay_date).slice(0, 10) !== cur.pay_date) await rebuildCustomer(client, cur.customer_id);
    await client.query('COMMIT');
    res.json({ message: 'Đã cập nhật phiếu thanh toán' });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi cập nhật phiếu thanh toán' }); }
  finally { client.release(); }
};

// HỦY phiếu (nhập nhầm) { reason } — giữ dấu vết. Gỡ mọi phần đã trừ vào phiếu giao,
// rồi phân bổ lại tiền trả trước của các phiếu khác (nếu có) cho khách.
exports.cancel = async (req, res) => {
  if (!canEditAmounts(req)) return noEdit(res);
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ message: 'Vui lòng nhập lý do hủy phiếu.' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = (await client.query(
      `UPDATE payment_receipts SET is_cancelled = TRUE, cancelled_by = $2, cancelled_at = now(), cancel_reason = $3, updated_at = now()
       WHERE id = $1 AND is_cancelled = FALSE RETURNING id, receipt_code, customer_id`, [req.params.id, req.userId || null, reason])).rows[0];
    if (!r) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu (hoặc đã hủy trước đó).' }); }
    // Tính lại cách trừ nợ của khách từ đầu (không còn phiếu này) → phiếu giao cũ nhất vẫn được trả trước
    await rebuildCustomer(client, r.customer_id);
    await client.query('COMMIT');
    res.json({ message: `Đã hủy phiếu ${r.receipt_code}` });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi hủy phiếu thanh toán' }); }
  finally { client.release(); }
};

// Công nợ hiện tại của 1 khách + phiếu giao còn nợ (cũ → mới) + đơn hàng — dùng khi lập phiếu thanh toán
// và khi chọn khách ở phiếu giao (cảnh báo nợ xấu / chặn vượt hạn mức).
exports.customerSummary = async (req, res) => {
  try {
    if (!canViewAmounts(req)) {
      // Không có quyền xem tiền vẫn cần biết khách có bị chặn tạo phiếu giao hay không (không lộ số tiền)
      const { rows } = await customerDebts(db, req.params.customerId);
      const d = rows[0] || {};
      return res.json({ level: d.level || 'ok', is_bad: !!d.is_bad, over_limit: !!d.over_limit, oldest_days: d.oldest_days || 0, amounts_hidden: true });
    }
    const { rows, settings } = await customerDebts(db, req.params.customerId);
    const notes = (await db.query(`
      SELECT id, note_code, delivery_date, total_amount, paid_amount, total_amount - paid_amount AS due, status,
             ${debtAgeSql('delivery_notes')} AS age_days
      FROM delivery_notes
      WHERE customer_id = $1 AND is_deleted = FALSE AND status = ANY($2::text[]) AND total_amount - paid_amount > 0.005
      ORDER BY COALESCE(delivery_date, created_at::date), created_at`, [req.params.customerId, PAYABLE_STATUSES])).rows; // = thứ tự trừ nợ thật (allocateCustomer)
    const orders = (await db.query(`
      SELECT id, order_code, order_date, status FROM sales_orders
      WHERE customer_id = $1 AND is_deleted = FALSE AND status <> 'Đã hủy' ORDER BY order_date DESC, order_code DESC`,
      [req.params.customerId])).rows;
    res.json({ ...(rows[0] || { debt: 0, credit: 0, level: 'ok' }), settings, open_notes: notes, orders });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy công nợ khách hàng' }); }
};

// BÁO CÁO CÔNG NỢ: từng khách — phải trả / đã trả / còn nợ / trả trước / nợ quá hạn / mức cảnh báo
exports.receivables = async (req, res) => {
  if (!canViewAmounts(req)) return noView(res);
  try {
    const { rows, settings } = await customerDebts(db);
    res.json({ data: rows, settings });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy báo cáo công nợ' }); }
};

// Chi tiết công nợ 1 khách: mọi phiếu giao đã giao + mọi phiếu thanh toán (để đối chiếu)
exports.receivableDetail = async (req, res) => {
  if (!canViewAmounts(req)) return noView(res);
  try {
    const cid = req.params.customerId;
    const { rows, settings } = await customerDebts(db, cid);
    const notes = (await db.query(`
      SELECT id, note_code, delivery_date, total_amount, paid_amount, total_amount - paid_amount AS due, status,
             ${debtAgeSql('delivery_notes')} AS age_days
      FROM delivery_notes
      WHERE customer_id = $1 AND is_deleted = FALSE AND status = ANY($2::text[])
      ORDER BY delivery_date DESC NULLS LAST, created_at DESC`, [cid, PAYABLE_STATUSES])).rows;
    const receipts = (await db.query(`${RECEIPT_SELECT} WHERE r.customer_id = $1 ORDER BY r.pay_date DESC, r.created_at DESC`, [cid])).rows;
    res.json({ ...(rows[0] || {}), settings, notes, receipts });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết công nợ' }); }
};
