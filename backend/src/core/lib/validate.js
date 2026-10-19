// backend/src/core/lib/validate.js — kiểm dữ liệu danh mục dùng chung (F4).

// Chuẩn hoá tên để so trùng: bỏ khoảng trắng đầu/cuối + gộp khoảng trắng thừa, không phân biệt hoa/thường
const NORM_SQL = (expr) => `lower(regexp_replace(btrim(${expr}), '\\s+', ' ', 'g'))`;
const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * duplicateNameMessage(conn, { table, nameCol, codeCol, label }, name, id)
 *   Trả thông báo nếu đã có bản ghi KHÁC (chưa xóa) cùng tên, ngược lại null.
 *   Khi sửa (id có giá trị): chỉ kiểm khi TÊN ĐỔI — dữ liệu cũ lỡ trùng vẫn sửa được các trường khác.
 */
async function duplicateNameMessage(conn, { table, nameCol = 'name', codeCol, label }, name, id = null) {
  const n = normName(name);
  if (!n) return null;
  if (id) {
    const cur = (await conn.query(`SELECT ${nameCol} AS v FROM ${table} WHERE id = $1`, [id])).rows[0];
    if (cur && normName(cur.v) === n) return null;
  }
  const r = (await conn.query(
    `SELECT ${codeCol} AS code FROM ${table}
      WHERE is_deleted = FALSE AND ${NORM_SQL(nameCol)} = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
    [n, id])).rows[0];
  return r ? `${label} "${String(name).trim()}" đã tồn tại (mã ${r.code}). Vui lòng đặt tên khác.` : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail = (s) => EMAIL_RE.test(String(s).trim());
// Giờ dạng HH:MM hoặc HH:MM:SS, 00:00 → 23:59
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(s).trim());

module.exports = { duplicateNameMessage, normName, isEmail, isTime };
