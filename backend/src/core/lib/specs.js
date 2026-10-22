// backend/lib/specs.js — bộ thông số kỹ thuật chuẩn (đồng bộ với src/specs.js ở FE)
// Thứ tự cố định để spec_key luôn nhất quán khi gom nhóm tồn kho.
const SPEC_NAMES = ['Số lớp', 'Chiều dài', 'Chiều ngang (Rộng)', 'Độ dày', 'Màu sắc'];

// Chỉ giữ các thông số có giá trị, chuẩn hoá chuỗi
function cleanSpecs(specs) {
  const o = {};
  if (specs && typeof specs === 'object') {
    for (const n of SPEC_NAMES) {
      const v = specs[n] || specs[n.replace(' (Rộng)', '')]; // Hỗ trợ đọc DB cũ (nếu có key 'Chiều ngang')
      if (v != null && String(v).trim() !== '') o[n] = String(v).trim();
    }
  }
  return o;
}

// Khoá gom nhóm "thông số giống nhau" — chuỗi cố định theo SPEC_NAMES
function buildSpecKey(specs) {
  const s = cleanSpecs(specs);
  return SPEC_NAMES.map((n) => s[n] || '').join('|');
}

// Suy ra 3 thuộc tính cũ (attr_size/thickness/color) để các màn cũ vẫn hiển thị được
function legacyAttrs(specs) {
  const s = cleanSpecs(specs);
  const dai = s['Chiều dài'] || '';
  const ngang = s['Chiều ngang (Rộng)'] || s['Chiều ngang'] || '';
  const size = dai || ngang ? `${ngang}${ngang && dai ? ' × ' : ''}${dai}` : '';
  return { size, thickness: s['Độ dày'] || '', color: s['Màu sắc'] || '' };
}

// attr_size kiểu cũ "Rộng × Dài" (đúng chiều legacyAttrs ghép ra) → tách về 2 thông số riêng.
// Trước đây cả chuỗi bị nhét vào "Chiều dài" → spec_key lệch với đơn hàng, phiếu giao không thấy hàng.
function splitLegacySize(size) {
  const s = String(size || '').trim();
  const m = s.split(/\s*[×xX]\s*/);
  if (m.length === 2 && (m[0] || m[1])) return { ngang: m[0].trim(), dai: m[1].trim() };
  return { ngang: '', dai: s };
}

// Lấy specs từ body: ưu tiên body.specs (object), nếu không có thì dựng từ attr_* cũ.
// base: thông số đang có (khi SỬA) — giữ lại các thông số form cũ không gửi (vd Số lớp).
function specsFromBody(b, base = null) {
  if (b && b.specs && typeof b.specs === 'object') return cleanSpecs(b.specs);
  const o = { ...cleanSpecs(base || {}) };
  if (b) {
    const put = (k, v) => { if (v) o[k] = String(v).trim(); else delete o[k]; };
    if (b.attr_color !== undefined) put('Màu sắc', b.attr_color);
    if (b.attr_thickness !== undefined) put('Độ dày', b.attr_thickness);
    if (b.attr_size !== undefined) {
      const { ngang, dai } = splitLegacySize(b.attr_size);
      put('Chiều ngang (Rộng)', ngang); put('Chiều dài', dai);
    }
  }
  return cleanSpecs(o);
}

// Thứ tự HIỂN THỊ (giống form FE: Rộng trước Dài) — khác SPEC_NAMES (thứ tự khóa), đừng dùng để dựng spec_key.
const DISPLAY_NAMES = ['Số lớp', 'Chiều ngang (Rộng)', 'Chiều dài', 'Độ dày', 'Màu sắc'];
const specValuesLabel = (specs) => { const s = cleanSpecs(specs); return DISPLAY_NAMES.map((n) => s[n]).filter(Boolean); };
// Nhãn từ spec_key ("Số lớp|Dài|Rộng|Dày|Màu") → đảo về Rộng · Dài
const specKeyValues = (key) => { const p = String(key || '').split('|'); if (p.length >= 3) [p[1], p[2]] = [p[2], p[1]]; return p.filter(Boolean); };

module.exports = { SPEC_NAMES, cleanSpecs, buildSpecKey, legacyAttrs, specsFromBody, splitLegacySize, specValuesLabel, specKeyValues };
