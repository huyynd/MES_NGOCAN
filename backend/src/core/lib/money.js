// backend/src/core/lib/money.js
// Dùng CHUNG cho mọi nơi hiển thị tiền (Dashboard, Báo cáo, Phiếu giao, Đơn hàng)
// để một chỉ số tiền chỉ có MỘT định nghĩa, tránh mỗi báo cáo tự lọc kiểu khác nhau.

// Quyền xem số liệu tiền (doanh thu / công nợ): chỉ 4 vai trò quản lý
// (Quản trị vận hành, Kế toán, Kinh doanh, Quản trị hệ thống) qua quyền deliveries.view_amounts.
function canViewAmounts(req, app = 'deliveries') {
  if (req.user?.is_admin) return true;
  const p = req.user?.permissions?.[app];
  const v = p?.view_amounts, f = p?.fields?.amounts;
  return v === 'ALLOW' || v === true || v?.status === 'ALLOW' || f === 'edit' || f === 'view';
}

// Quyền GHI tiền (ghi nhận / hủy thanh toán): admin, hoặc quyền view_amounts của app (frontend coi là "edit"),
// hoặc trường amounts = 'edit'. Trường amounts = 'view' chỉ được xem.
function canEditAmounts(req, app = 'deliveries') {
  if (req.user?.is_admin) return true;
  const p = req.user?.permissions?.[app];
  const v = p?.view_amounts, f = p?.fields?.amounts;
  if (f === 'view') return false;
  return v === 'ALLOW' || v === true || v?.status === 'ALLOW' || f === 'edit';
}

// ĐỊNH NGHĨA DUY NHẤT "phiếu giao tính vào tiền / công nợ" = đã giao hàng (đã trừ kho).
// Bản nháp (chưa phát sinh) và Đã hủy KHÔNG tính. Mọi truy vấn tiền / công nợ / "đã giao" PHẢI dùng
// PAYABLE_NOTE_STATUSES (tham số SQL) hoặc moneyNoteFilter(alias) — KHÔNG tự viết lại điều kiện trạng thái.
const PAYABLE_NOTE_STATUSES = ['Giao hàng', 'Đã xuất hóa đơn', 'Chờ thanh toán', 'Đã thanh toán 1 phần', 'Đã thanh toán'];

// Điều kiện SQL chuẩn (gắn thẳng vào WHERE). alias = tên/alias bảng delivery_notes (vd 'd', 'dn', 'delivery_notes').
const moneyNoteFilter = (alias = 'd') =>
  `${alias}.is_deleted = FALSE AND ${alias}.status IN (${PAYABLE_NOTE_STATUSES.map((s) => `'${s}'`).join(',')})`;

module.exports = { canViewAmounts, canEditAmounts, moneyNoteFilter, PAYABLE_NOTE_STATUSES };
