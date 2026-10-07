// backend/controllers/genericCrud.js
// Factory tạo bộ CRUD chuẩn cho các bảng master-data.
const db = require('./db');

/**
 * makeCrud(cfg)
 *  table        : tên bảng
 *  columns      : các cột cho phép insert/update
 *  searchCols   : cột lọc kiểu ILIKE (?q hoặc ?<col>)
 *  exactCols    : cột lọc khớp tuyệt đối (?<col>)
 *  softDelete   : true nếu bảng có cột is_deleted
 *  orderBy      : mệnh đề ORDER BY (mặc định created_at DESC)
 */
function makeCrud(cfg) {
  const {
    table, columns, searchCols = [], exactCols = [],
    softDelete = true, orderBy = 'created_at DESC',
    codeCol = null, // cột mã định danh (vd employee_code) — dùng để chặn trùng khi import
    extraSelect = '', // biểu thức SELECT bổ sung (vd cột suy ra), bắt đầu bằng dấu phẩy
  } = cfg;

  const list = async (req, res) => {
    try {
      const where = [];
      const params = [];
      let i = 1;
      if (softDelete) where.push('is_deleted = FALSE');

      if (req.query.q && searchCols.length) {
        const ors = searchCols.map(c => `${c} ILIKE $${i}`);
        params.push(`%${req.query.q}%`);
        i++;
        where.push(`(${ors.join(' OR ')})`);
      }
      for (const c of searchCols) {
        if (req.query[c]) { where.push(`${c} ILIKE $${i++}`); params.push(`%${req.query[c]}%`); }
      }
      for (const c of exactCols) {
        if (req.query[c] !== undefined && req.query[c] !== '') {
          where.push(`${c} = $${i++}`); params.push(req.query[c]);
        }
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 50, 1), 500);
      const offset = (page - 1) * pageSize;

      const totalRes = await db.query(`SELECT COUNT(*)::int AS total FROM ${table} ${whereSql}`, params);
      const total = totalRes.rows[0].total;
      const dataRes = await db.query(
        `SELECT * ${extraSelect} FROM ${table} ${whereSql} ORDER BY ${orderBy} LIMIT $${i++} OFFSET $${i++}`,
        [...params, pageSize, offset]
      );
      res.json({ data: dataRes.rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
    } catch (err) { console.error(err); res.status(500).json({ message: `Lỗi khi lấy danh sách ${table}` }); }
  };

  const getById = async (req, res) => {
    try {
      const sd = softDelete ? 'AND is_deleted = FALSE' : '';
      const { rows } = await db.query(`SELECT * ${extraSelect} FROM ${table} WHERE id = $1 ${sd}`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy bản ghi' });
      res.json(rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết' }); }
  };

  const pick = (body) => {
    const cols = [], vals = [];
    for (const c of columns) {
      if (body[c] !== undefined) { cols.push(c); vals.push(body[c] === '' ? null : body[c]); }
    }
    return { cols, vals };
  };

  const create = async (req, res) => {
    try {
      const { cols, vals } = pick(req.body);
      if (!cols.length) return res.status(400).json({ message: 'Thiếu dữ liệu' });
      const ph = cols.map((_, k) => `$${k + 1}`).join(',');
      const { rows } = await db.query(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals);
      res.status(201).json(rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ message: err.detail || `Lỗi khi tạo ${table}` }); }
  };

  const update = async (req, res) => {
    try {
      const { cols, vals } = pick(req.body);
      if (!cols.length) return res.status(400).json({ message: 'Không có trường nào để cập nhật' });
      const setSql = cols.map((c, k) => `${c} = $${k + 1}`).join(', ');
      const { rows } = await db.query(
        `UPDATE ${table} SET ${setSql} WHERE id = $${cols.length + 1} RETURNING *`,
        [...vals, req.params.id]);
      if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy bản ghi' });
      res.json(rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi cập nhật' }); }
  };

  const remove = async (req, res) => {
    try {
      // Chặn xóa khi đang ở trạng thái HOẠT ĐỘNG / ĐANG TIẾN HÀNH (chỉ xóa khi đã kết thúc).
      // Không xóa cứng — luôn chỉ soft delete (is_deleted) để giữ liên kết dữ liệu các phân hệ khác.
      const blocked = cfg.blockDeleteStatuses || (cfg.blockDeleteActive ? [cfg.blockDeleteActive] : []);
      if (blocked.length) {
        const sd = softDelete ? 'AND is_deleted = FALSE' : '';
        const r = await db.query(`SELECT status FROM ${table} WHERE id = $1 ${sd}`, [req.params.id]);
        if (!r.rows.length) return res.status(404).json({ message: 'Không tìm thấy bản ghi' });
        if (blocked.includes(r.rows[0].status)) {
          return res.status(400).json({
            message: cfg.blockDeleteMessage ||
              `Không thể xóa khi đang "${r.rows[0].status}". Chỉ xóa được khi đã chuyển sang trạng thái kết thúc (Không hoạt động / Đã nghỉ / Hủy / Ngừng). Vui lòng đổi trạng thái trước.`,
          });
        }
      }
      const q = softDelete
        ? `UPDATE ${table} SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`
        : `DELETE FROM ${table} WHERE id = $1`;
      const { rowCount } = await db.query(q, [req.params.id]);
      if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy bản ghi' });
      res.json({ message: 'Đã xóa' });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa' }); }
  };

  // Cột được phép insert khi import (kèm cột mã nếu có)
  const importCols = codeCol ? [codeCol, ...columns] : columns;
  const pickImport = (body) => {
    const cols = [], vals = [];
    for (const c of importCols) {
      if (body[c] !== undefined) { cols.push(c); vals.push(body[c] === '' ? null : body[c]); }
    }
    return { cols, vals };
  };

  // Nhập hàng loạt (import Excel) — CHẶN TRÙNG MÃ, bỏ qua dòng lỗi, trả thống kê
  const bulkCreate = async (req, res) => {
    const client = await db.pool.connect();
    try {
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      if (!rows.length) return res.status(400).json({ message: 'Không có dòng nào để nhập' });

      // Tập mã đã có trên hệ thống (để chặn trùng)
      let existing = new Set();
      if (codeCol) {
        const sd = softDelete ? 'WHERE is_deleted = FALSE' : '';
        const er = await client.query(`SELECT ${codeCol} AS c FROM ${table} ${sd}`);
        existing = new Set(er.rows.map((r) => String(r.c).trim().toUpperCase()).filter(Boolean));
      }
      const seen = new Set(); // mã đã gặp trong chính file này

      // 1 transaction + SAVEPOINT cho TỪNG dòng: dòng lỗi chỉ rollback riêng nó,
      // các dòng hợp lệ commit chung ở cuối (không để lỗi 1 dòng làm dở dang/kẹt kết nối).
      await client.query('BEGIN');
      let inserted = 0; const errors = [];
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx] || {};
        const rawCode = codeCol && row[codeCol] != null ? String(row[codeCol]).trim() : '';
        const codeKey = rawCode.toUpperCase();
        // Chặn trùng theo mã
        if (rawCode) {
          if (seen.has(codeKey)) { errors.push({ row: idx + 2, message: `Mã "${rawCode}" bị trùng trong file — đã bỏ qua` }); continue; }
          if (existing.has(codeKey)) { errors.push({ row: idx + 2, message: `Mã "${rawCode}" đã tồn tại trên hệ thống — đã bỏ qua` }); continue; }
        }
        const { cols, vals } = pickImport(row);
        if (!cols.length) { errors.push({ row: idx + 2, message: 'Dòng trống / thiếu dữ liệu' }); continue; }
        await client.query('SAVEPOINT sp_row');
        try {
          const ph = cols.map((_, k) => `$${k + 1}`).join(',');
          await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph})`, vals);
          await client.query('RELEASE SAVEPOINT sp_row');
          inserted++;
          if (rawCode) { seen.add(codeKey); existing.add(codeKey); }
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT sp_row');
          errors.push({ row: idx + 2, message: e.detail || e.message });
        }
      }
      await client.query('COMMIT');
      res.json({ inserted, failed: errors.length, errors: errors.slice(0, 50) });
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); console.error(err); res.status(500).json({ message: `Lỗi khi nhập ${table}` }); }
    finally { client.release(); }
  };

  return { list, getById, create, update, remove, bulkCreate };
}

module.exports = { makeCrud };
