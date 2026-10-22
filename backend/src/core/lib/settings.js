// Cài đặt hệ thống (bảng app_settings) — NGUỒN DUY NHẤT để đọc các giá trị nghiệp vụ chỉnh được.
// Mặc định = giá trị trước đây gắn cứng trong code → chưa ai sửa thì hành vi không đổi.
// Thêm 1 cài đặt mới: khai báo ở DEFS (nhóm, nhãn, kiểu, giới hạn) — màn "Cài đặt hệ thống" tự hiện.

const DEFS = {
  vat_percent:         { group: 'Bán hàng',   label: 'VAT hiển thị ở form đơn hàng (%)', type: 'number', min: 0, max: 100, def: 8,
                         hint: 'Chỉ để hiển thị trên đơn hàng — phiếu giao / công nợ tính trước VAT' },
  urgent_days:         { group: 'Kế hoạch',   label: 'Đơn "gấp" khi còn ≤ N ngày tới hạn', type: 'int', min: 0, max: 365, def: 5 },
  priority_top:        { group: 'Kế hoạch',   label: 'Số lô ưu tiên hiển thị', type: 'int', min: 1, max: 100, def: 5 },
  scrap_alert_percent: { group: 'Sản xuất',   label: 'Tỷ lệ phế cảnh báo đỏ (%)', type: 'number', min: 0, max: 100, def: 5 },
  schedule_lock_days:  { group: 'Sản xuất',   label: 'Lịch làm việc khóa sửa sau (ngày)', type: 'int', min: 0, max: 365, def: 3 },
  near_min_percent:    { group: 'Kho',        label: '"Gần định mức" khi tồn dưới (% tồn tối thiểu)', type: 'number', min: 100, max: 1000, def: 120 },
  debt_bad_days:       { group: 'Công nợ',    label: 'Nợ xấu khi quá hạn (ngày)', type: 'int', min: 1, max: 3650, def: 30 },
  debt_limit_amount:   { group: 'Công nợ',    label: 'Hạn mức nợ chặn lập phiếu giao (đ)', type: 'number', min: 0, max: 1e13, def: 300000000 },
  company_name:        { group: 'Công ty (in trên phiếu)', label: 'Tên công ty', type: 'text', max: 200, def: 'CÔNG TY TNHH THƯƠNG MẠI SẢN XUẤT XNK BAO BÌ NGỌC AN THƯ' },
  company_tax:         { group: 'Công ty (in trên phiếu)', label: 'Mã số thuế', type: 'text', max: 30, def: '0316748578' },
  company_address:     { group: 'Công ty (in trên phiếu)', label: 'Địa chỉ', type: 'text', max: 300, def: '119/1 Đường Đỗ Mười, Tổ 4, Khu phố 1, Phường Thới An, Thành Phố Hồ Chí Minh' },
  company_phone:       { group: 'Công ty (in trên phiếu)', label: 'Điện thoại', type: 'text', max: 50, def: '0938 446 156' },
};

// Đọc toàn bộ cài đặt đã khai báo (trộn giá trị lưu trong DB với mặc định)
async function getAppSettings(conn) {
  const rows = (await conn.query(`SELECT key, value FROM app_settings WHERE key = ANY($1)`, [Object.keys(DEFS)])).rows;
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const [k, d] of Object.entries(DEFS)) {
    const v = saved[k];
    if (d.type === 'text') out[k] = typeof v === 'string' ? v : d.def;
    else { const n = Number(v); out[k] = v != null && Number.isFinite(n) ? n : d.def; }
  }
  return out;
}

// Kiểm 1 giá trị gửi lên → { value } hoặc { error }
function validateSetting(key, raw) {
  const d = DEFS[key];
  if (!d) return { error: `Cài đặt không hợp lệ: ${key}` };
  if (d.type === 'text') {
    const s = String(raw ?? '').trim();
    if (!s) return { error: `"${d.label}" không được để trống` };
    if (s.length > d.max) return { error: `"${d.label}" quá dài (tối đa ${d.max} ký tự)` };
    return { value: s };
  }
  const n = Number(raw);
  if (raw === '' || raw == null || !Number.isFinite(n)) return { error: `"${d.label}" phải là số` };
  if (d.type === 'int' && !Number.isInteger(n)) return { error: `"${d.label}" phải là số nguyên` };
  if (n < d.min || n > d.max) return { error: `"${d.label}" phải trong khoảng ${d.min}–${d.max}` };
  return { value: n };
}

module.exports = { DEFS, getAppSettings, validateSetting };
