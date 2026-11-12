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

module.exports = { finalStageSql, FINAL_STAGE_OF_TASK };
