// Ai được xem gì — dữ liệu khách hàng.
//  - Xem danh sách khách / đơn hàng: có quyền xem Khách hàng (md_customers), Đơn hàng (orders) hoặc Giao hàng (deliveries).
//  - Xem THÔNG TIN LIÊN HỆ khách (SĐT, email, địa chỉ, MST): chỉ người làm việc trực tiếp với khách —
//    xem danh mục Khách hàng, tạo/sửa đơn hàng, hoặc được xem tiền (đơn hàng / giao hàng).
//    Người chỉ XEM đơn (vd Quản lý sản xuất) vẫn thấy tên khách nhưng không thấy liên hệ.
const { hasAppPerm } = require('../requireAuth');
const { canViewAmounts } = require('./money');

const CONTACT_FIELDS = ['phone', 'email', 'address', 'tax_code', 'customer_phone', 'customer_email', 'customer_address', 'customer_tax_code'];

function canViewCustomerContact(req) {
  return hasAppPerm(req, 'md_customers', 'view')
    || hasAppPerm(req, 'orders', 'create') || hasAppPerm(req, 'orders', 'edit')
    || canViewAmounts(req, 'orders') || canViewAmounts(req, 'deliveries');
}

const stripRow = (r) => {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return r;
  const out = { ...r };
  for (const f of CONTACT_FIELDS) if (f in out) out[f] = null;
  if (out.customer && typeof out.customer === 'object') out.customer = stripRow(out.customer);
  return out;
};

/** Middleware: người không có quyền liên hệ → xóa trường liên hệ khỏi JSON trả về ({data:[...]}, {data:{...}}, [...], {...}). */
function hideCustomerContact(req, res, next) {
  if (canViewCustomerContact(req)) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 || !body || typeof body !== 'object') return json(body);
    const strip = (v) => (Array.isArray(v) ? v.map(stripRow) : stripRow(v));
    if ('data' in body) return json({ ...body, data: strip(body.data) });
    return json(strip(body));
  };
  next();
}

module.exports = { canViewCustomerContact, hideCustomerContact, CONTACT_FIELDS };
