// Tổng hợp phế theo ngày — MỘT định nghĩa cho Báo cáo sản lượng (/scrap/summary) và Báo cáo giám đốc.
// Phế: module Quản lý phế, theo ngày cân. Thành phẩm: Σ công đoạn CUỐI đã hoàn thành trong ngày
// (phiếu phế không nhập TP — finished_qty luôn 0 → trước đây tỷ lệ phế 100% / "—").
// Ngày của task theo updated_at (người dùng chấp nhận, 2026-11-10). Lệnh Đã hủy: GIỮ phần đã sản xuất, phế vẫn tính (chốt 2026-11-13, thay chốt 2026-11-10).
const { FINAL_STAGE_OF_TASK } = require('./finalStage');
const { IS_KG_ORDER } = require('./periodOutput');
// Chốt 2026-11-13: thành phẩm (mẫu số tỷ lệ phế) CHỈ tính lệnh KG.

async function scrapByDay(db, from, to) {
  const { rows } = await db.query(`
    WITH s AS (
      SELECT dsr.record_date AS d, SUM(dsi.scrap_qty) AS scrap_qty
      FROM daily_scrap_records dsr
      JOIN daily_scrap_items dsi ON dsi.record_id = dsr.id
      WHERE dsr.record_date BETWEEN $1::date AND $2::date
      GROUP BY dsr.record_date
    ), f AS (
      SELECT (t.updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d, SUM(COALESCE(t.actual_qty, t.quantity)) AS finished_qty
      FROM production_tasks t
      JOIN production_orders po ON po.id = t.production_order_id AND po.is_deleted = FALSE
      LEFT JOIN products p ON p.id = po.product_id
      WHERE ${IS_KG_ORDER()} AND t.status = 'Hoàn thành'
        AND (t.updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
        AND t.stage = ${FINAL_STAGE_OF_TASK}
      GROUP BY (t.updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    )
    SELECT COALESCE(s.d, f.d)::text AS date,
           COALESCE(s.scrap_qty, 0)::numeric    AS scrap_qty,
           COALESCE(f.finished_qty, 0)::numeric AS finished_qty
    FROM s FULL JOIN f ON f.d = s.d
    ORDER BY 1`, [from, to]);
  const by_day = rows.map((r) => ({
    date: r.date, scrap_qty: Number(r.scrap_qty) || 0, finished_qty: Number(r.finished_qty) || 0,
  }));
  // Thành phẩm làm ra trong kỳ THEO LỆNH (kể cả lệnh tạo trước kỳ) — để Báo cáo sản lượng lọc theo
  // sản phẩm / đội / trạng thái. Đội = cùng cách hiển thị assigned_team_display của danh sách lệnh.
  const byOrder = await db.query(`
    SELECT t.production_order_id AS order_id, p.product_code, po.status,
           COALESCE(NULLIF((SELECT STRING_AGG(DISTINCT t5.assigned_team, ', ') FROM production_tasks t5
              WHERE t5.production_order_id = po.id AND t5.assigned_team IS NOT NULL AND t5.assigned_team != ''), ''),
             po.assigned_team) AS team,
           SUM(COALESCE(t.actual_qty, t.quantity))::numeric AS finished_qty
    FROM production_tasks t
    JOIN production_orders po ON po.id = t.production_order_id AND po.is_deleted = FALSE
    LEFT JOIN products p ON p.id = po.product_id
    WHERE ${IS_KG_ORDER()} AND t.status = 'Hoàn thành'
      AND (t.updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $1::date AND $2::date
      AND t.stage = ${FINAL_STAGE_OF_TASK}
    GROUP BY t.production_order_id, po.id, p.product_code, po.status, po.assigned_team`, [from, to]);
  return {
    by_day,
    by_order: byOrder.rows.map((r) => ({ order_id: r.order_id, product_code: r.product_code, status: r.status,
      team: r.team || '', finished_qty: Number(r.finished_qty) || 0 })),
    total_scrap: by_day.reduce((a, r) => a + r.scrap_qty, 0),
    total_finished: by_day.reduce((a, r) => a + r.finished_qty, 0),
  };
}

module.exports = { scrapByDay };
