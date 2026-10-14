// backend/src/core/lib/stock.js
// MỘT CỬA DUY NHẤT để thay đổi tồn kho + ghi giao dịch.
// Mọi luồng nhập/xuất/điều chỉnh/backflush/phế/tái chế phải đi qua applyStock()
// để: (1) khóa nhóm tồn (spec_key) luôn nhất quán = buildSpecKey(specs),
//     (2) luôn ghi 1 dòng inventory_transactions tương ứng (kèm delta CÓ DẤU để đối soát),
//     (3) KHÔNG BAO GIỜ cho tồn âm — trừ tồn là 1 câu UPDATE có điều kiện (khóa dòng + kiểm đủ + trừ
//         trong cùng 1 bước), thiếu thì ném StockShortageError → transaction rollback.
const { buildSpecKey, legacyAttrs } = require('./specs');
const { upUnit } = require('./units');

// Lỗi thiếu tồn — nơi gọi trả 400 kèm thông báo dễ hiểu (xem stockErrorResponse)
class StockShortageError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'StockShortageError';
    this.code = 'STOCK_SHORTAGE';
    this.status = 400;
    this.detail = detail;
  }
}

// Làm tròn đúng thang lưu numeric(14,2) — tránh sai số số thực (0.1 + 0.2…) làm hụt/âm 0.01
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtQty = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

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
 *   log = true,          // ghi inventory_transactions
 *   trx_type,            // 'Nhập'|'Xuất'|'Điều chỉnh'; mặc định suy từ dấu delta
 *   ref_code = null, note = null,
 *   clampZero            // ĐÃ BỎ: trước đây true = ép về 0 khi thiếu (sổ cái vẫn ghi đủ → lệch sổ cái),
 *                        //        false = cho âm. Nay thiếu tồn LUÔN báo lỗi; tham số được bỏ qua.
 * }
 * @returns {Promise<number>} tồn mới của dòng
 * @throws {StockShortageError} khi trừ quá số đang có
 */
async function applyStock(client, o) {
  const specs = o.specs || {};
  const spec_key = o.spec_key != null ? o.spec_key : buildSpecKey(specs);
  const a = o.attrs || legacyAttrs(specs);
  const delta = round2(o.delta);
  const lot = o.lot_code || '';
  const loc = o.location_id || null;
  let newQty = null;

  if (delta < 0) {
    // TRỪ: khóa dòng + kiểm đủ + trừ trong 1 câu (atomic). 2 phiếu trừ cùng lúc → phiếu sau chờ phiếu trước
    // xong rồi mới đánh giá điều kiện trên số tồn MỚI → không thể cùng lọt.
    const r = await client.query(
      `UPDATE inventory_stock
          SET quantity = quantity + $5::numeric,
              unit = COALESCE($6, unit),
              updated_at = now()
        WHERE product_id = $1 AND location_id IS NOT DISTINCT FROM $2 AND spec_key = $3 AND lot_code = $4
          AND quantity + $5::numeric >= 0
        RETURNING quantity`,
      [o.product_id, loc, spec_key, lot, delta, upUnit(o.unit) || null]);
    if (!r.rows.length) {
      // Không trừ được → đọc tồn hiện tại + tên SP để báo rõ
      const info = (await client.query(
        `SELECT p.product_code, p.product_name,
                (SELECT COALESCE(SUM(quantity), 0) FROM inventory_stock
                  WHERE product_id = $1 AND location_id IS NOT DISTINCT FROM $2 AND spec_key = $3 AND lot_code = $4) AS on_hand
           FROM products p WHERE p.id = $1`, [o.product_id, loc, spec_key, lot])).rows[0] || {};
      const onHand = Number(info.on_hand) || 0;
      const name = [info.product_code, info.product_name].filter(Boolean).join(' ') || 'Sản phẩm';
      throw new StockShortageError(
        `Không đủ tồn kho: ${name}${lot ? ` (lô ${lot})` : ''} — tồn ${fmtQty(onHand)}, cần trừ ${fmtQty(-delta)}, thiếu ${fmtQty(-delta - onHand)}.`,
        { product_id: o.product_id, location_id: loc, spec_key, lot_code: lot, on_hand: onHand, need: -delta });
    }
    newQty = Number(r.rows[0].quantity);
  } else {
    // NHẬP (hoặc 0): upsert cộng dồn
    const r = await client.query(
      `INSERT INTO inventory_stock
         (product_id, location_id, specs, spec_key, lot_code, prod_order_id, attr_size, attr_thickness, attr_color, quantity, unit)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (product_id, location_id, spec_key, lot_code)
       DO UPDATE SET quantity = inventory_stock.quantity + EXCLUDED.quantity,
                     -- Không ghi đè specs đã có bằng {} (trường hợp chỉ biết spec_key)
                     specs = CASE WHEN inventory_stock.specs = '{}'::jsonb THEN EXCLUDED.specs ELSE inventory_stock.specs END,
                     unit = COALESCE(EXCLUDED.unit, inventory_stock.unit),
                     -- FIFO (M50): dòng đã hết hàng nay nhập lại → coi như lô mới vào kho
                     created_at = CASE WHEN inventory_stock.quantity <= 0 AND EXCLUDED.quantity > 0
                                       THEN now() ELSE inventory_stock.created_at END,
                     updated_at = now()
       RETURNING quantity`,
      [o.product_id, loc, JSON.stringify(specs), spec_key, lot,
       o.prod_order_id || null, a.size || '', a.thickness || '', a.color || '', delta, upUnit(o.unit) || null]);
    newQty = r.rows[0] ? Number(r.rows[0].quantity) : null;
  }

  if (o.log !== false && delta !== 0) {
    // quantity: giữ giá trị TUYỆT ĐỐI như cũ (tương thích); delta: CÓ DẤU — để biết "Điều chỉnh" là tăng hay giảm
    await client.query(
      `INSERT INTO inventory_transactions
         (product_id, location_id, trx_type, quantity, delta, specs, spec_key, lot_code, attr_size, attr_thickness, attr_color, ref_code, note)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
      [o.product_id, loc, o.trx_type || (delta > 0 ? 'Nhập' : 'Xuất'), Math.abs(delta), delta,
       JSON.stringify(specs), spec_key, lot, a.size || '', a.thickness || '', a.color || '',
       o.ref_code || null, o.note || null]);
  }
  return newQty;
}

// Dùng trong catch của controller: lỗi thiếu tồn → 400 kèm thông báo; trả true nếu đã xử lý.
function stockErrorResponse(res, err) {
  if (err && err.code === 'STOCK_SHORTAGE') {
    res.status(400).json({ message: err.message, shortage: err.detail });
    return true;
  }
  // Lưới an toàn ở CSDL: CHECK (quantity >= 0) chặn một đường ghi tồn nào đó lọt qua applyStock
  if (err && err.code === '23514' && err.constraint === 'inventory_stock_quantity_nonneg') {
    res.status(400).json({ message: 'Không đủ tồn kho — thao tác sẽ làm tồn kho âm nên đã bị chặn. Vui lòng tải lại và kiểm tra tồn.' });
    return true;
  }
  return false;
}

module.exports = { applyStock, StockShortageError, stockErrorResponse };
