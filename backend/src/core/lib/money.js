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

// Điều kiện SQL CHUẨN cho "phiếu giao tính vào tiền/công nợ":
// loại phiếu Bản nháp (chưa phát sinh) và Đã hủy. Dùng alias bảng delivery_notes (vd 'd' hoặc 'dn').
const moneyNoteFilter = (alias = 'd') =>
  `${alias}.is_deleted = FALSE AND ${alias}.status NOT IN ('Bản nháp','Đã hủy')`;

module.exports = { canViewAmounts, moneyNoteFilter };
