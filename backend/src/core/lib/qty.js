// backend/src/core/lib/qty.js — kiểm số lượng dùng chung ở biên API (QA NN-1).
// Cột số lượng là numeric(14,2): làm tròn 2 số lẻ; phải là số hữu hạn, < 1e12; > 0 (hoặc ≥ 0 khi allowZero).
const QTY_MAX = 1e12;

const roundQty = (n) => Math.round(Number(n) * 100) / 100;

/** Trả câu lỗi (chuỗi) hoặc null nếu hợp lệ. label: tên ô hiển thị, ví dụ "Số lượng", "SL thực". */
function qtyError(v, { label = 'Số lượng', allowZero = false } = {}) {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (!Number.isFinite(n)) return `${label} phải là số (nhận: ${v}).`;
  if (Math.abs(n) >= QTY_MAX) return `${label} quá lớn (tối đa dưới 1.000.000.000.000).`;
  const r = roundQty(n);
  if (allowZero ? r < 0 : r <= 0) return allowZero ? `${label} phải là số ≥ 0 (nhận: ${v}).` : `${label} tối thiểu 0,01.`;
  if (allowZero && r === 0 && n > 0) return `${label} tối thiểu 0,01 (hoặc nhập 0).`;
  return null;
}

module.exports = { QTY_MAX, roundQty, qtyError };
