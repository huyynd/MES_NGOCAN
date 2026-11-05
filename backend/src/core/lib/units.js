// backend/lib/units.js — chuẩn hoá đơn vị tính: luôn VIẾT HOA (KG, CÁI…).
// Danh mục dùng chung cho dropdown; CSDL cũng có trigger ép viết hoa (migrate mục 33).
const UNITS = ["KG", "CÁI", "CHIẾC", "DEM", "GRAM", "CUỘN", "THÙNG"];

function upUnit(u) {
  if (u == null) return null;
  const s = String(u).trim();
  return s ? s.toUpperCase() : null;
}
module.exports = { upUnit, UNITS };
