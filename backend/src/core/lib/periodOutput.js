// SẢN LƯỢNG THEO KỲ — MỘT định nghĩa cho Báo cáo sản lượng, Báo cáo giám đốc và app mobile (chốt 2026-11-13).
//
// Với kỳ [from, to]:
//   • Lệnh MỚI (tạo trong kỳ)                    → kế hoạch = toàn bộ quantity.
//   • Lệnh CHUYỂN SANG (tạo trước kỳ, đầu kỳ còn mở: chưa Hoàn thành / chưa Hủy trước ngày from)
//                                                 → kế hoạch = max(0, quantity − đã làm trước kỳ). Treo bao lâu cũng chuyển dồn.
//   • Lệnh HỦY TRONG KỲ                           → kế hoạch = phần đã làm trong kỳ (phần hủy không kéo tiến độ xuống), còn lại 0.
//   • Hoàn thành (actual) = làm ra trong kỳ ở công đoạn cuối (kể cả lệnh đã hủy — giữ phần đã làm).
//   • Còn lại = max(0, kế hoạch − làm trong kỳ); làm vượt → còn lại 0, ghi phần vượt ở `over`.
//   • Lệnh ĐÃ ĐÓNG TRƯỚC KỲ mà có sản lượng ghi trong kỳ (sửa task cũ…) → kế hoạch 0, chỉ góp thực tế, không đếm số lệnh.
//   • Trạng thái / quá hạn tính TẠI NGÀY CUỐI KỲ (xem lại kỳ cũ không bị trạng thái hôm nay làm sai).
//   • Tổng chỉ cộng lệnh đơn vị KG; lệnh đơn vị khác đếm ở non_kg_count. Ngày theo giờ Việt Nam.
// Ngày làm ra của task = updated_at (cùng quy ước scrapSummary, chốt 2026-11-10).
const { FINAL_STAGE_OF_TASK } = require('./finalStage');

// Lệnh tính bằng KG — MỘT định nghĩa (po: bí danh lệnh, p: bí danh sản phẩm). Dùng cả ở scrapSummary (tỷ lệ phế chỉ KG).
const IS_KG_ORDER = (po = 'po', p = 'p') => `upper(COALESCE(NULLIF(${po}.unit,''), ${p}.unit, '')) = 'KG'`;

const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

// Ngày theo giờ Việt Nam (DB mặc định UTC → việc làm 00:00–07:00 bị lùi sang hôm trước). Cùng quy ước với scrapSummary.
const VN = (col) => `(${col} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;

async function periodOutput(db, from, to, { ids, scopeSql = 'TRUE' } = {}) {
  const params = [from, to];
  let idCond = '';
  if (ids) { params.push(ids); idCond = `AND po.id = ANY($3::uuid[])`; }
  const { rows } = await db.query(`
    WITH po_k AS (
      -- Lệnh của kỳ: tạo trong kỳ, HOẶC tạo trước kỳ và đầu kỳ còn mở, HOẶC có sản lượng ghi trong kỳ (lệnh đã đóng — chỉ tính thực tế)
      SELECT po.* FROM production_orders po
      WHERE po.is_deleted = FALSE AND ${VN('po.created_at')} <= $2::date AND (${scopeSql}) ${idCond}
        AND (${VN('po.created_at')} >= $1::date
             OR (COALESCE(${VN('po.completed_at')} >= $1::date, TRUE) AND COALESCE(${VN('po.cancelled_at')} >= $1::date, TRUE))
             OR EXISTS (SELECT 1 FROM production_tasks t WHERE t.production_order_id = po.id AND t.status = 'Hoàn thành'
                          AND ${VN('t.updated_at')} BETWEEN $1::date AND $2::date))
    ), done AS (
      SELECT t.production_order_id AS id,
             SUM(COALESCE(t.actual_qty, t.quantity)) FILTER (WHERE ${VN('t.updated_at')} <  $1::date) AS before_qty,
             SUM(COALESCE(t.actual_qty, t.quantity)) FILTER (WHERE ${VN('t.updated_at')} BETWEEN $1::date AND $2::date) AS in_qty
      FROM production_tasks t JOIN po_k ON po_k.id = t.production_order_id
      WHERE t.status = 'Hoàn thành' AND t.stage = ${FINAL_STAGE_OF_TASK}
      GROUP BY t.production_order_id
    )
    SELECT po.id, po.order_code, po.status, po.quantity::numeric AS quantity,
           po.due_date::text AS due_date, ${VN('po.created_at')}::text AS created_date,
           p.product_code, p.product_name, COALESCE(NULLIF(po.unit,''), p.unit) AS unit,
           ${IS_KG_ORDER()} AS is_kg,
           ${VN('po.created_at')} >= $1::date AS is_new,
           COALESCE(${VN('po.completed_at')} < $1::date OR ${VN('po.cancelled_at')} < $1::date, FALSE) AS closed_before,
           COALESCE(${VN('po.cancelled_at')} BETWEEN $1::date AND $2::date, FALSE) AS cancelled_in_period,
           COALESCE(${VN('po.completed_at')} <= $2::date, FALSE) AS completed_by_end,
           COALESCE(${VN('po.cancelled_at')} > $2::date OR ${VN('po.completed_at')} > $2::date, FALSE) AS closed_after,
           COALESCE(d.before_qty, 0)::numeric AS before_qty, COALESCE(d.in_qty, 0)::numeric AS in_qty,
           -- Quá hạn TẠI NGÀY CUỐI KỲ (kỳ đang chạy: tại hôm nay)
           COALESCE(po.due_date < LEAST(${VN('now()')}, $2::date + 1)
             AND NOT COALESCE(${VN('po.completed_at')} <= $2::date, FALSE)
             AND NOT COALESCE(${VN('po.cancelled_at')} <= $2::date, FALSE), FALSE) AS overdue
    FROM po_k po
    LEFT JOIN products p ON p.id = po.product_id
    LEFT JOIN done d ON d.id = po.id
    ORDER BY po.created_at DESC`, params);

  const orders = rows.map((r) => {
    const qty = Number(r.quantity), before = Number(r.before_qty), actual = Number(r.in_qty);
    const plan = r.closed_before ? 0 : r.cancelled_in_period ? actual : r.is_new ? qty : Math.max(0, qty - before);
    // Trạng thái TẠI NGÀY CUỐI KỲ: đóng (xong / hủy) sau kỳ → trong kỳ đó lệnh còn mở → 'Đang sản xuất'
    const status = r.closed_after ? 'Đang sản xuất' : r.status;
    return {
      id: r.id, code: r.order_code, product_code: r.product_code, product_name: r.product_name, unit: r.unit,
      status, status_now: r.status, created: r.created_date, due: r.due_date, overdue: r.overdue, is_kg: r.is_kg,
      origin: r.is_new ? 'new' : 'carry', closed_before: r.closed_before,
      cancelled_in_period: r.cancelled_in_period, quantity: r1(qty), done_before: r1(before),
      plan: r1(plan), actual: r1(actual), remaining: r1(Math.max(0, plan - actual)), over: r1(Math.max(0, actual - plan)),
    };
  });
  return { orders, summary: summarize(orders) };
}

/** Tổng hợp một danh sách lệnh (đã lọc tùy ý) — dùng chung cho mọi màn. */
function summarize(orders) {
  // Lệnh "đếm được" của kỳ: bỏ lệnh hủy trong kỳ và lệnh đã đóng trước kỳ (lệnh đó chỉ góp phần thực tế)
  const live = orders.filter((o) => !o.cancelled_in_period && !o.closed_before);
  const kg = orders.filter((o) => o.is_kg);
  const sum = (list, k) => r1(list.reduce((s, o) => s + o[k], 0));
  const cnt = (fn) => live.filter(fn).length;
  return {
    plan: sum(kg, 'plan'), carry_plan: sum(kg.filter((o) => o.origin === 'carry'), 'plan'),
    new_plan: sum(kg.filter((o) => o.origin === 'new'), 'plan'),
    actual: sum(kg, 'actual'), remaining: sum(kg, 'remaining'), over: sum(kg, 'over'),
    non_kg_count: live.filter((o) => !o.is_kg).length,
    total: live.length, carry_count: cnt((o) => o.origin === 'carry'), new_count: cnt((o) => o.origin === 'new'),
    done: cnt((o) => o.status === 'Hoàn thành'), running: cnt((o) => o.status === 'Đang sản xuất'),
    wait_nvl: cnt((o) => o.status === 'Chờ nguyên vật liệu'),
    not_started: cnt((o) => o.status === 'Chờ duyệt' || o.status === 'Đã lên kế hoạch'),
    overdue: cnt((o) => o.overdue), cancelled: orders.filter((o) => o.cancelled_in_period).length,
  };
}

module.exports = { periodOutput, summarize, IS_KG_ORDER };
