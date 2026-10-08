// backend/src/core/lib/stock.js
// MỘT CỬA DUY NHẤT để thay đổi tồn kho + ghi giao dịch.
// Mọi luồng nhập/xuất/điều chỉnh/backflush/phế/tái chế phải đi qua applyStock()
// để: (1) khóa nhóm tồn (spec_key) luôn nhất quán = buildSpecKey(specs),
//     (2) luôn ghi 1 dòng inventory_transactions tương ứng, (3) tùy chọn chặn âm.
const { buildSpecKey, legacyAttrs } = require('./specs');
const { upUnit } = require('./units');

/**
 * @param {object} client  pg client ĐANG trong transaction (đã BEGIN)
 * @param {object} o {
 *   product_id, location_id,
 *   delta,               // signed: >0 nhập, <0 xuất
 *   unit,
 *   specs,               // object thông số; spec_key & attr_* suy ra từ đây (chuẩn hoá)
 *   spec_key,            // (tuỳ chọn) ép khóa nhóm đúng dòng tồn có sẵn; mặc định buildSpecKey(specs)
 *   lot_code = '',
 *   prod_order_id = null,
 *   clampZero = true,    // true: không cho tồn âm (GREATEST(0,...)); false: cho phép âm
 *   log = true,          // ghi inventory_transactions
 *   trx_type,            // 'Nhập'|'Xuất'|'Điều chỉnh'; mặc định suy từ dấu delta
 *   ref_code = null, note = null,
 * }
 * @returns {Promise<number>} tồn mới của dòng
 */
async function applyStock(client, o) {
  const specs = o.specs || {};
  const spec_key = o.spec_key != null ? o.spec_key : buildSpecKey(specs);
  const a = o.attrs || legacyAttrs(specs);
  const delta = Number(o.delta) || 0;
  const clamp = o.clampZero !== false; // mặc định KHÔNG cho âm
  const setExpr = clamp
    ? 'GREATEST(0, inventory_stock.quantity + EXCLUDED.quantity)'
    : 'inventory_stock.quantity + EXCLUDED.quantity';

  const r = await client.query(
    `INSERT INTO inventory_stock
       (product_id, location_id, specs, spec_key, lot_code, prod_order_id, attr_size, attr_thickness, attr_color, quantity, unit)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (product_id, location_id, spec_key, lot_code)
     DO UPDATE SET quantity = ${setExpr},
                   -- Không ghi đè specs đã có bằng {} (trường hợp xuất chỉ biết spec_key)
                   specs = CASE WHEN inventory_stock.specs = '{}'::jsonb THEN EXCLUDED.specs ELSE inventory_stock.specs END,
                   unit = COALESCE(EXCLUDED.unit, inventory_stock.unit),
                   -- FIFO (M50): dòng đã hết hàng nay nhập lại → coi như lô mới vào kho
                   created_at = CASE WHEN inventory_stock.quantity <= 0 AND EXCLUDED.quantity > 0
                                     THEN now() ELSE inventory_stock.created_at END,
                   updated_at = now()
     RETURNING quantity`,
    [o.product_id, o.location_id || null, JSON.stringify(specs), spec_key, o.lot_code || '',
     o.prod_order_id || null, a.size || '', a.thickness || '', a.color || '', delta, upUnit(o.unit) || null]);

  if (o.log !== false && delta !== 0) {
    await client.query(
      `INSERT INTO inventory_transactions
         (product_id, location_id, trx_type, quantity, specs, spec_key, lot_code, attr_size, attr_thickness, attr_color, ref_code, note)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)`,
      [o.product_id, o.location_id || null, o.trx_type || (delta > 0 ? 'Nhập' : 'Xuất'), Math.abs(delta),
       JSON.stringify(specs), spec_key, o.lot_code || '', a.size || '', a.thickness || '', a.color || '',
       o.ref_code || null, o.note || null]);
  }
  return r.rows[0] ? Number(r.rows[0].quantity) : null;
}

module.exports = { applyStock };
