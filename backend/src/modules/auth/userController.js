// backend/controllers/userController.js — quản lý tài khoản (không trả mật khẩu)
const db = require('../../core/db');
const { hashPassword } = require('./authController');

exports.list = async (req, res) => {
  try {
    const where = ['u.is_deleted = FALSE']; const params = []; let i = 1;
    if (req.query.q) { where.push(`(u.username ILIKE $${i} OR u.full_name ILIKE $${i})`); params.push(`%${req.query.q}%`); i++; }
    const { rows } = await db.query(`
      SELECT u.id, u.username, u.full_name, u.status, u.role_id, u.team, u.linked_worker, r.name AS role_name
      FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE ${where.join(' AND ')} ORDER BY u.username`, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy danh sách tài khoản' }); }
};

exports.getById = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, username, full_name, status, role_id, team, linked_worker, COALESCE(permissions, '{}'::jsonb) AS permissions FROM users WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi' }); }
};

const VALID_STATUSES = ['Hoạt động', 'Không hoạt động'];

exports.create = async (req, res) => {
  try {
    const { username, password, full_name, role_id, status, team, linked_worker } = req.body;
    if (!username || typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 50)
      return res.status(400).json({ message: 'Tài khoản phải từ 3–50 ký tự' });
    if (!password || typeof password !== 'string' || password.length < 6 || password.length > 100)
      return res.status(400).json({ message: 'Mật khẩu phải từ 6–100 ký tự' });
    const resolvedStatus = status || 'Hoạt động';
    if (!VALID_STATUSES.includes(resolvedStatus))
      return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, full_name, role_id, status, team, linked_worker) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [username.trim(), hashPassword(password), full_name ? String(full_name).slice(0, 100) : null,
       role_id || null, resolvedStatus, team ? String(team).slice(0, 100) : null, linked_worker ? String(linked_worker).slice(0, 100) : null]);
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ message: 'Tài khoản đã tồn tại' });
    console.error('[userController.create]', e);
    res.status(500).json({ message: 'Lỗi tạo tài khoản' });
  }
};

exports.update = async (req, res) => {
  try {
    const { username, password, full_name, role_id, status, team, permissions, linked_worker } = req.body;
    const cols = [], vals = []; let i = 1;
    const add = (c, v) => { cols.push(`${c} = $${i++}`); vals.push(v); };
    if (username !== undefined) {
      if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 50)
        return res.status(400).json({ message: 'Tài khoản phải từ 3–50 ký tự' });
      add('username', username.trim());
    }
    if (full_name !== undefined) add('full_name', full_name ? String(full_name).slice(0, 100) : null);
    if (role_id !== undefined) add('role_id', role_id || null);
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
      add('status', status);
    }
    if (team !== undefined) add('team', team ? String(team).slice(0, 100) : null);
    if (linked_worker !== undefined) add('linked_worker', linked_worker ? String(linked_worker).slice(0, 100) : null);
    if (permissions !== undefined) add('permissions', JSON.stringify(permissions));
    if (password) {
      if (typeof password !== 'string' || password.length < 6 || password.length > 100)
        return res.status(400).json({ message: 'Mật khẩu phải từ 6–100 ký tự' });
      add('password_hash', hashPassword(password));
    }
    if (!cols.length) return res.status(400).json({ message: 'Không có trường để cập nhật' });
    // Đổi mật khẩu → tăng token_version: mọi phiên đang đăng nhập của tài khoản này (web + điện thoại) hết hiệu lực ngay.
    const bump = password ? ', token_version = token_version + 1' : '';
    const sql = (extra) => `UPDATE users SET ${cols.join(', ')}${extra} WHERE id = $${i} AND is_deleted = FALSE RETURNING id`;
    let rows;
    try {
      ({ rows } = await db.query(sql(bump), [...vals, req.params.id]));
    } catch (e) {
      if (e.code !== '42703' || !bump) throw e; // chưa migrate cột token_version → cập nhật như cũ
      ({ rows } = await db.query(sql(''), [...vals, req.params.id]));
    }
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    res.json({ message: 'Đã cập nhật tài khoản' });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ message: 'Tài khoản đã tồn tại' });
    console.error('[userController.update]', e);
    res.status(500).json({ message: 'Lỗi cập nhật tài khoản' });
  }
};

exports.remove = async (req, res) => {
  try {
    const { rowCount } = await db.query(`UPDATE users SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    res.json({ message: 'Đã xóa tài khoản' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa' }); }
};
