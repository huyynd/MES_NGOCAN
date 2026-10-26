// Tiến độ Thổi / Cắt của các lệnh SX gắn với dòng đơn — dùng chung cho Đơn hàng và Phiếu giao.
// Trả về Map(sales_order_item_id → [{ id, order_code, quantity, unit, status, blow_plan, blow_done, cut_plan, cut_done }]).
// *_done = tổng SL (thực, nếu có) các lần đã "Hoàn thành"; *_plan = tổng SL kế hoạch các lần.
async function lsxProgressByItems(conn, itemIds) {
  const map = new Map();
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  if (!ids.length) return map;
  const { rows } = await conn.query(`
    SELECT po.sales_order_item_id, po.id, po.order_code, po.quantity, po.unit, po.status,
           COALESCE(SUM(t.quantity) FILTER (WHERE t.stage = 'Thổi'), 0) AS blow_plan,
           COALESCE(SUM(COALESCE(t.actual_qty, t.quantity)) FILTER (WHERE t.stage = 'Thổi' AND t.status = 'Hoàn thành'), 0) AS blow_done,
           COALESCE(SUM(t.quantity) FILTER (WHERE t.stage = 'Cắt'), 0) AS cut_plan,
           COALESCE(SUM(COALESCE(t.actual_qty, t.quantity)) FILTER (WHERE t.stage = 'Cắt' AND t.status = 'Hoàn thành'), 0) AS cut_done
    FROM production_orders po
    LEFT JOIN production_tasks t ON t.production_order_id = po.id
    WHERE po.sales_order_item_id = ANY($1::uuid[]) AND po.is_deleted = FALSE
    GROUP BY po.id
    ORDER BY po.created_at`, [ids]);
  for (const r of rows) {
    if (!map.has(r.sales_order_item_id)) map.set(r.sales_order_item_id, []);
    map.get(r.sales_order_item_id).push(r);
  }
  return map;
}

module.exports = { lsxProgressByItems };
