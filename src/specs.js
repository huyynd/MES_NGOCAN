// src/specs.js — bộ thông số kỹ thuật chuẩn cho Đơn hàng & Kho (đồng bộ backend/lib/specs.js)
// kind: "text" (nhập tự do) | "select" (chọn) | "num" (số + đơn vị cố định) | "numunit" (số + chọn đơn vị)
export const PRODUCT_SPECS = [
  { name: "Số lớp", kind: "text", placeholder: "vd: 2 lớp" },
  { name: "Chiều ngang (Rộng)", kind: "num", unit: "Cm" },
  { name: "Chiều dài", kind: "num", unit: "Cm" },
  { name: "Độ dày", kind: "numunit", units: ["dem", "cem", "zem"] },
  { name: "Màu sắc", kind: "text", placeholder: "vd: Trắng sữa" },
];
export const SPEC_NAMES = PRODUCT_SPECS.map((s) => s.name);

// tách "120 mm" -> { num: "120", unit: "mm" }
export const splitNU = (v) => {
  const m = String(v || "").trim().match(/^([\d.,]+)?\s*(\S+)?$/);
  return { num: (m && m[1]) || "", unit: (m && m[2]) || "" };
};

// chỉ giữ thông số có giá trị
export const cleanSpecs = (specs = {}) => {
  const o = {};
  for (const n of SPEC_NAMES) { const v = specs?.[n]; if (v != null && String(v).trim() !== "") o[n] = String(v).trim(); }
  return o;
};

// khoá gom nhóm (phải khớp backend)
export const buildSpecKey = (specs = {}) => SPEC_NAMES.map((n) => String(specs?.[n] || "").trim()).join("|");

// nhãn từ spec_key của backend (thứ tự khóa "Số lớp|Dài|Rộng|Dày|Màu") → hiển thị Rộng · Dài như form
export const specKeyLabel = (key, empty = "—") => {
  const p = String(key || "").split("|");
  if (p.length >= 3) [p[1], p[2]] = [p[2], p[1]];
  return p.filter(Boolean).join(" · ") || empty;
};

// nhãn đầy đủ: "Số lớp: 2 lớp · Chiều dài: 120 mm · ..."
export const specLabel = (specs = {}) => SPEC_NAMES.filter((n) => specs?.[n]).map((n) => `${n}: ${specs[n]}`).join(" · ");

// nhãn gọn: "2 lớp · 120 mm · 80 mm · 2.5 cem · Lục"
export const specShort = (specs = {}) => SPEC_NAMES.filter((n) => specs?.[n]).map((n) => specs[n]).join(" · ");
