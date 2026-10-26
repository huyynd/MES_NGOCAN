// backend/src/core/lib/receivables.js — CÔNG NỢ PHẢI THU (dùng chung Phiếu giao / Phiếu thanh toán / Báo cáo)
//
// Khách KHÔNG trả theo từng phiếu giao mà trả 1 cục bằng PHIẾU THANH TOÁN (payment_receipts).
// Tiền của các phiếu thanh toán được PHÂN BỔ vào các phiếu giao còn nợ, CŨ NHẤT TRƯỚC (FIFO theo ngày giao).
// Mỗi phần phân bổ = 1 dòng delivery_payments (receipt_id) → paid_amount + trạng thái phiếu giao tự cập nhật.
// Phần chưa phân bổ hết = TIỀN TRẢ TRƯỚC: tự trừ khi khách có phiếu giao mới (gọi allocateCustomer sau khi giao).

const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);
const EPS = 0.005; // tiền làm tròn 2 chữ số

// Trạng thái phiếu giao có tính tiền (đã giao) — dùng ĐỊNH NGHĨA CHUNG ở money.js, không tự khai báo lại.
const { PAYABLE_NOTE_STATUSES: PAYABLE_STATUSES } = require('./money');
const { getAppSettings } = require('./settings');

// TUỔI NỢ (số ngày) của 1 phiếu giao — MỘT quy tắc cho mọi màn: tính từ ngày giao; phiếu thiếu ngày giao
// thì tính từ ngày tạo phiếu (không bỏ sót / không màn tính màn bỏ). alias = tên/alias bảng delivery_notes.
const debtAgeSql = (alias = 'd') => `(CURRENT_DATE - COALESCE(${alias}.delivery_date, ${alias}.created_at::date))`;

// Ngưỡng công nợ từ app_settings (mặc định 30 ngày / 300 triệu nếu chưa cấu hình)
async function getDebtSettings(conn) {
  // đọc qua helper chung (core/lib/settings.js) — mặc định 30 ngày / 300 triệu
  const s = await getAppSettings(conn);
  return { bad_days: s.debt_bad_days, limit_amount: s.debt_limit_amount };
}

// Tính lại số đã trả = Σ phần thu chưa hủy, và TỰ đặt trạng thái thanh toán:
//   đã trả ≥ tổng tiền → "Đã thanh toán"; 0 < đã trả < tổng → "Đã thanh toán 1 phần";
//   = 0 → giữ nguyên, trừ khi đang ở trạng thái thanh toán (do hủy) → về "Chờ thanh toán".
async function recomputePaid(client, noteId) {
  const r = (await client.query(`
    UPDATE delivery_notes d SET paid_amount = sub.s, updated_at = now()
    FROM (SELECT COALESCE(SUM(amount), 0) AS s FROM delivery_payments WHERE delivery_note_id = $1 AND is_cancelled = FALSE) sub
    WHERE d.id = $1 RETURNING d.paid_amount, d.total_amount, d.status`, [noteId])).rows[0];
  if (!r || !PAYABLE_STATUSES.includes(r.status)) return;
  const paid = num(r.paid_amount), total = num(r.total_amount);
  let st = r.status;
  if (paid > EPS && paid >= total - EPS) st = 'Đã thanh toán';
  else if (paid > EPS) st = 'Đã thanh toán 1 phần';
  else if (['Đã thanh toán 1 phần', 'Đã thanh toán'].includes(r.status)) st = 'Chờ thanh toán';
  if (st !== r.status) await client.query(`UPDATE delivery_notes SET status = $1 WHERE id = $2`, [st, noteId]);
}

// PHÂN BỔ tiền chưa dùng của các phiếu thanh toán vào phiếu giao còn nợ của 1 khách — FIFO cả 2 phía:
// phiếu thanh toán cũ nhất trả cho phiếu giao cũ nhất trước. Gọi TRONG transaction.
// Khóa các phiếu thanh toán của khách (FOR UPDATE) → 2 request cùng khách chạy tuần tự, không phân bổ trùng.
// NỢ ĐẦU KỲ (customer_opening_balances): còn nợ đầu kỳ = khoản nợ CŨ NHẤT (trừ trước mọi phiếu giao);
// đã trả đầu kỳ dư (> tổng nợ) = nguồn tiền CŨ NHẤT (trừ trước mọi phiếu thanh toán).
// Các số đã phân bổ của từng phía, tính trên DB:
const OPENING_SQL = `
  SELECT o.id, o.cutoff_date,
         GREATEST(o.total_debt - o.paid_before, 0)
           - COALESCE((SELECT SUM(op.amount) FROM opening_balance_payments op WHERE op.customer_id = o.customer_id), 0) AS due,
         GREATEST(o.paid_before - o.total_debt, 0)
           - COALESCE((SELECT SUM(p.amount) FROM delivery_payments p JOIN delivery_notes d ON d.id = p.delivery_note_id
                       WHERE p.from_opening AND p.is_cancelled = FALSE AND d.customer_id = o.customer_id), 0) AS excess
  FROM customer_opening_balances o WHERE o.customer_id = $1`;

async function allocateCustomer(client, customerId) {
  if (!customerId) return;
  const opening = (await client.query(`${OPENING_SQL} FOR UPDATE OF o`, [customerId])).rows[0];
  const receipts = (await client.query(`
    SELECT r.id, r.receipt_code, r.pay_date, r.method, r.amount,
           r.amount - COALESCE((SELECT SUM(p.amount) FROM delivery_payments p
                                 WHERE p.receipt_id = r.id AND p.is_cancelled = FALSE), 0)
                    - COALESCE((SELECT SUM(op.amount) FROM opening_balance_payments op WHERE op.receipt_id = r.id), 0) AS unallocated
    FROM payment_receipts r
    WHERE r.customer_id = $1 AND r.is_cancelled = FALSE
    ORDER BY r.pay_date, r.created_at
    FOR UPDATE`, [customerId])).rows.filter((r) => num(r.unallocated) > EPS);
  // Tiền đầu kỳ dư đứng TRƯỚC mọi phiếu thanh toán
  if (opening && num(opening.excess) > EPS) {
    receipts.unshift({ id: null, opening: true, pay_date: opening.cutoff_date, method: null, unallocated: opening.excess });
  }
  if (!receipts.length) return;

  const notes = (await client.query(`
    SELECT id, note_code, total_amount - paid_amount AS due
    FROM delivery_notes
    WHERE customer_id = $1 AND is_deleted = FALSE AND status = ANY($2::text[])
      AND total_amount - paid_amount > ${EPS}
    ORDER BY COALESCE(delivery_date, created_at::date), created_at -- cùng mốc ngày với debtAgeSql
    FOR UPDATE`, [customerId, PAYABLE_STATUSES])).rows;
  // Nợ đầu kỳ đứng TRƯỚC mọi phiếu giao
  if (opening && num(opening.due) > EPS) notes.unshift({ id: null, opening: true, due: opening.due });

  const touched = new Set();
  let ri = 0;
  for (const n of notes) {
    let due = num(n.due);
    while (due > EPS && ri < receipts.length) {
      const r = receipts[ri];
      const left = num(r.unallocated);
      const take = Math.round(Math.min(due, left) * 100) / 100;
      if (take > EPS) {
        // (đầu kỳ dư không bao giờ gặp nợ đầu kỳ: 1 khách chỉ có 1 trong 2)
        if (n.opening) {
          await client.query(
            `INSERT INTO opening_balance_payments (customer_id, receipt_id, amount) VALUES ($1, $2, $3)`,
            [customerId, r.id, take]);
        } else {
          await client.query(
            `INSERT INTO delivery_payments (delivery_note_id, pay_date, amount, method, note, receipt_id, from_opening)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [n.id, r.pay_date, take, r.method || 'Tiền mặt', r.opening ? 'Trả trước từ nợ đầu kỳ' : `Theo phiếu thanh toán ${r.receipt_code}`, r.id, !!r.opening]);
          touched.add(n.id);
        }
      }
      due -= take;
      r.unallocated = left - take;
      if (num(r.unallocated) <= EPS) ri++;
    }
    if (ri >= receipts.length) break;
  }
  for (const id of touched) await recomputePaid(client, id);
}

// PHÂN BỔ LẠI TỪ ĐẦU cho 1 khách (sau khi hủy / đổi ngày phiếu thanh toán): bỏ mọi phần phân bổ của
// phiếu thanh toán (chỉ là số liệu suy ra — phiếu thanh toán mới là chứng từ gốc, vẫn giữ nguyên),
// tính lại các phiếu giao bị ảnh hưởng, rồi chạy FIFO lại → phiếu giao cũ nhất luôn được trả trước.
// Lần thu cũ (receipt_id NULL, trước khi có phiếu thanh toán) giữ nguyên.
async function rebuildCustomer(client, customerId) {
  if (!customerId) return;
  await client.query(`SELECT id FROM payment_receipts WHERE customer_id = $1 FOR UPDATE`, [customerId]);
  const del = (await client.query(`
    DELETE FROM delivery_payments p USING payment_receipts r
    WHERE p.receipt_id = r.id AND r.customer_id = $1
    RETURNING p.delivery_note_id`, [customerId])).rows;
  // Phần phân bổ của nợ đầu kỳ cũng chỉ là số suy ra → bỏ và tính lại
  del.push(...(await client.query(`
    DELETE FROM delivery_payments p USING delivery_notes d
    WHERE p.delivery_note_id = d.id AND d.customer_id = $1 AND p.from_opening
    RETURNING p.delivery_note_id`, [customerId])).rows);
  await client.query(`DELETE FROM opening_balance_payments WHERE customer_id = $1`, [customerId]);
  for (const id of new Set(del.map((x) => x.delivery_note_id))) await recomputePaid(client, id);
  await allocateCustomer(client, customerId);
}

// Công nợ của các khách (hoặc 1 khách): phải trả / đã trả / còn nợ / trả trước / nợ xấu / vượt hạn mức.
//   Phải trả  = Σ tổng tiền phiếu giao đã giao + tổng nợ đầu kỳ
//   Đã trả    = Σ phiếu thanh toán còn hiệu lực + Σ lần thu cũ (trước khi có phiếu thanh toán) + đã trả đầu kỳ
//   Còn nợ    = Σ (tổng − đã trả) của từng phiếu giao
//   Trả trước = Σ tiền phiếu thanh toán chưa phân bổ
//   Nợ xấu    = có phiếu giao còn nợ quá bad_days ngày kể từ ngày giao
async function customerDebts(conn, customerId = null) {
  const s = await getDebtSettings(conn);
  const { rows } = await conn.query(`
    WITH notes AS (
      SELECT d.customer_id,
             SUM(d.total_amount) AS billed,
             SUM(GREATEST(d.total_amount - d.paid_amount, 0)) AS debt,
             SUM(GREATEST(d.total_amount - d.paid_amount, 0))
               FILTER (WHERE ${debtAgeSql('d')} > $2) AS overdue_debt,
             COUNT(*) FILTER (WHERE d.total_amount - d.paid_amount > ${EPS}) AS open_count,
             MAX(${debtAgeSql('d')}) FILTER (WHERE d.total_amount - d.paid_amount > ${EPS}) AS oldest_days,
             MAX(d.delivery_date) AS last_delivery
      FROM delivery_notes d
      WHERE d.is_deleted = FALSE AND d.status = ANY($1::text[])
      GROUP BY d.customer_id
    ),
    rcpt AS (
      SELECT r.customer_id, SUM(r.amount) AS receipts_total, COUNT(*) AS receipt_count, MAX(r.pay_date) AS last_pay,
             SUM(r.amount - COALESCE((SELECT SUM(p.amount) FROM delivery_payments p
                                       WHERE p.receipt_id = r.id AND p.is_cancelled = FALSE), 0)
                          - COALESCE((SELECT SUM(op.amount) FROM opening_balance_payments op WHERE op.receipt_id = r.id), 0)) AS credit
      FROM payment_receipts r WHERE r.is_cancelled = FALSE
      GROUP BY r.customer_id
    ),
    legacy AS (
      SELECT d.customer_id, SUM(p.amount) AS legacy_paid, MAX(p.pay_date) AS legacy_last_pay
      FROM delivery_payments p JOIN delivery_notes d ON d.id = p.delivery_note_id
      WHERE p.receipt_id IS NULL AND NOT p.from_opening AND p.is_cancelled = FALSE AND d.is_deleted = FALSE AND d.status = ANY($1::text[])
      GROUP BY d.customer_id
    ),
    -- Nợ đầu kỳ: phải trả += tổng nợ, đã trả += đã trả đầu kỳ, còn nợ / trả trước = phần chưa phân bổ
    op AS (
      SELECT o.customer_id, o.total_debt, o.paid_before, (CURRENT_DATE - o.cutoff_date) AS age,
             GREATEST(o.total_debt - o.paid_before, 0)
               - COALESCE((SELECT SUM(x.amount) FROM opening_balance_payments x WHERE x.customer_id = o.customer_id), 0) AS due,
             GREATEST(o.paid_before - o.total_debt, 0)
               - COALESCE((SELECT SUM(p.amount) FROM delivery_payments p JOIN delivery_notes d ON d.id = p.delivery_note_id
                           WHERE p.from_opening AND p.is_cancelled = FALSE AND d.customer_id = o.customer_id), 0) AS excess
      FROM customer_opening_balances o
    )
    SELECT c.id AS customer_id, c.customer_code, c.name AS customer_name, c.phone,
           COALESCE(n.billed, 0) + COALESCE(o.total_debt, 0) AS billed,
           COALESCE(r.receipts_total, 0) + COALESCE(l.legacy_paid, 0) + COALESCE(o.paid_before, 0) AS paid,
           COALESCE(n.debt, 0) + GREATEST(COALESCE(o.due, 0), 0) AS debt,
           COALESCE(n.overdue_debt, 0) + CASE WHEN o.due > ${EPS} AND o.age > $2 THEN o.due ELSE 0 END AS overdue_debt,
           COALESCE(r.credit, 0) + GREATEST(COALESCE(o.excess, 0), 0) AS credit,
           (COALESCE(n.open_count, 0) + CASE WHEN o.due > ${EPS} THEN 1 ELSE 0 END)::int AS open_count,
           GREATEST(COALESCE(n.oldest_days, 0), CASE WHEN o.due > ${EPS} THEN o.age ELSE 0 END)::int AS oldest_days,
           COALESCE(r.receipt_count, 0)::int AS receipt_count,
           n.last_delivery, GREATEST(r.last_pay, l.legacy_last_pay) AS last_pay
    FROM customers c
    LEFT JOIN notes n ON n.customer_id = c.id
    LEFT JOIN rcpt r ON r.customer_id = c.id
    LEFT JOIN legacy l ON l.customer_id = c.id
    LEFT JOIN op o ON o.customer_id = c.id
    WHERE ($3::uuid IS NULL AND (n.customer_id IS NOT NULL OR r.customer_id IS NOT NULL OR o.customer_id IS NOT NULL)) OR c.id = $3::uuid
    ORDER BY 7 DESC, c.name -- 7 = debt`, [PAYABLE_STATUSES, s.bad_days, customerId]);
  return {
    settings: s,
    rows: rows.map((r) => {
      const debt = num(r.debt), overdue = num(r.overdue_debt);
      const is_bad = overdue > EPS;
      const over_limit = debt > s.limit_amount + EPS;
      return {
        ...r,
        billed: num(r.billed), paid: num(r.paid), debt, overdue_debt: overdue, credit: num(r.credit),
        is_bad, over_limit,
        level: over_limit ? 'blocked' : is_bad ? 'bad' : debt > EPS ? 'debt' : 'ok',
      };
    }),
  };
}

// TỔNG CÔNG NỢ TOÀN CÔNG TY — MỘT công thức cho mọi màn (Dashboard, Báo cáo giám đốc, Báo cáo công nợ):
//   billed = Σ phải trả · paid = Σ đã thu (GỒM tiền trả trước) · debt = Σ còn nợ · credit = Σ trả trước chưa trừ
async function receivableTotals(conn) {
  const { rows, settings } = await customerDebts(conn);
  const sum = (k) => Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;
  return {
    settings, rows,
    billed: sum('billed'), paid: sum('paid'), debt: sum('debt'), credit: sum('credit'), overdue: sum('overdue_debt'),
    customer_count: rows.filter((r) => r.debt > EPS).length,
  };
}

// Lỗi chặn khi khách vượt hạn mức nợ (trả null nếu được phép).
//  - extraAmount = 0 (tạo / đổi khách phiếu nháp): chặn khi khách ĐANG nợ vượt hạn mức.
//  - extraAmount > 0 (bấm Giao hàng): chặn khi nợ + giá trị phiếu này − tiền trả trước > hạn mức.
async function debtBlockMessage(conn, customerId, extraAmount = 0) {
  const { rows, settings } = await customerDebts(conn, customerId);
  const d = rows[0];
  if (!d) return null;
  const vnd = (x) => Math.round(x).toLocaleString('vi-VN');
  const extra = num(extraAmount);
  if (extra > EPS) {
    const after = d.debt + extra - d.credit;
    if (after <= settings.limit_amount + EPS) return null;
    return `Giao phiếu này (${vnd(extra)} đ) thì khách "${d.customer_name}" sẽ nợ ${vnd(after)} đ, vượt hạn mức ${vnd(settings.limit_amount)} đ`
      + ` (đang nợ ${vnd(d.debt)} đ${d.credit > EPS ? `, trả trước ${vnd(d.credit)} đ` : ''}). Cần thu tiền (Phiếu thanh toán) trước.`;
  }
  if (!d.over_limit) return null;
  return `Khách "${d.customer_name}" đang nợ ${vnd(d.debt)} đ, vượt hạn mức ${vnd(settings.limit_amount)} đ — không thể tạo phiếu giao mới. Cần thu tiền (Phiếu thanh toán) trước.`;
}

module.exports = { OPENING_SQL, PAYABLE_STATUSES, debtAgeSql, getDebtSettings, recomputePaid, allocateCustomer, rebuildCustomer, customerDebts, receivableTotals, debtBlockMessage };
