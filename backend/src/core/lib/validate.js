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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => UUID_RE.test(String(s || ''));
// router.param(name, uuidParam('Không tìm thấy …')): tham số đường dẫn không phải UUID → 404 (không để Postgres ném lỗi 500)
const uuidParam = (message) => (req, res, next, value) => (isUuid(value) ? next() : res.status(404).json({ message }));

/** Lỗi 500: ghi chi tiết ở server, trả câu chung (không lộ err.detail / câu lỗi CSDL). Lỗi tự ném (không phải CSDL) giữ câu. */
const isDbError = (err) => !!(err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) && err.severity);
// Giữ câu do code nghiệp vụ tự ném (new Error / lớp lỗi riêng); lỗi CSDL và lỗi lập trình (TypeError…) → câu chung.
const JS_BUG_ERRORS = [TypeError, RangeError, ReferenceError, SyntaxError, EvalError, URIError];
const clientMessage = (err, fallback) => (err instanceof Error && err.message && !isDbError(err)
  && !JS_BUG_ERRORS.some((C) => err instanceof C) ? err.message : fallback);

// Như clientMessage, nhưng lỗi dữ liệu đầu vào từ CSDL (lớp 22/23) đổi thành câu chung dễ hiểu — không lộ tên cột / giá trị.
const dbInputMessage = (err, fallback) => {
  const code = isDbError(err) ? err.code : '';
  if (code === '23505') return 'Dữ liệu bị trùng với bản ghi đã có.';
  if (code === '23503') return 'Dữ liệu tham chiếu không hợp lệ (bản ghi liên quan không tồn tại hoặc đang được dùng).';
  if (/^(22|23)/.test(code)) return 'Dữ liệu không hợp lệ.';
  return clientMessage(err, fallback);
};

module.exports = { duplicateNameMessage, normName, isEmail, isTime, isUuid, uuidParam, isDbError, clientMessage, dbInputMessage };
