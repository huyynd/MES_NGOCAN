// CÔNG ĐOẠN CUỐI của một lệnh — MỘT định nghĩa cho mọi nơi (chốt 2026-11-10):
//   • Sản phẩm Thành phẩm (bao bì) → luôn 'Cắt', kể cả khi chưa có dòng Cắt (mới thổi xong thì thành phẩm = 0).
//   • Còn lại: có công đoạn Cắt → 'Cắt', không → 'Thổi'.
// Khớp finalStageOf() ở productionController (bản JS). Thành phẩm / "đã sản xuất" chỉ tính ở công đoạn cuối.
//
// orderIdExpr: biểu thức SQL trỏ tới id lệnh, vd 'po.id' hoặc 't.production_order_id'.
function finalStageSql(orderIdExpr) {
  return `(CASE WHEN EXISTS (SELECT 1 FROM production_orders fpo JOIN products fp ON fp.id = fpo.product_id
                             WHERE fpo.id = ${orderIdExpr}
                               AND (CASE WHEN jsonb_array_length(COALESCE(fp.product_types, '[]'::jsonb)) > 0
                                         THEN fp.product_types ? 'Thành phẩm' AND NOT fp.product_types ? 'Bán thành phẩm'
                                         ELSE fp.product_type = 'Thành phẩm' END)) THEN 'Cắt'
                WHEN EXISTS (SELECT 1 FROM production_tasks tf
                             WHERE tf.production_order_id = ${orderIdExpr} AND tf.stage = 'Cắt') THEN 'Cắt'
                ELSE 'Thổi' END)`;
}

const FINAL_STAGE_OF_TASK = finalStageSql('t.production_order_id');

// Bản JS của finalStageSql (cùng quy tắc).
function finalStageOf(productType, productTypes, stages) {
  const types = (Array.isArray(productTypes) && productTypes.length) ? productTypes : (productType ? [productType] : []);
  if (types.includes('Thành phẩm') && !types.includes('Bán thành phẩm')) return 'Cắt';
  return stages.includes('Cắt') ? 'Cắt' : 'Thổi';
}

// SL đã SX của lệnh = tổng SL (thực, chưa nhập thì SL kế hoạch) các dòng công đoạn cuối đã Hoàn thành.
// ord: { product_type, product_types }; tasks: [{ stage, status, quantity, actual_qty }]. MỘT định nghĩa cho recomputeOrder + cổng NVL.
function producedFromTasks(ord, tasks) {
  const finalStage = finalStageOf(ord.product_type, ord.product_types, tasks.map((t) => t.stage));
  const qtyOf = (t) => (t.actual_qty == null ? Number(t.quantity) : Number(t.actual_qty)) || 0;
  return { finalStage, produced: tasks.filter((t) => t.stage === finalStage && t.status === 'Hoàn thành').reduce((s, t) => s + qtyOf(t), 0) };
}

module.exports = { finalStageSql, FINAL_STAGE_OF_TASK, finalStageOf, producedFromTasks };
