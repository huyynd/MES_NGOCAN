// backend/controllers/authController.js — đăng nhập + phiên (token trong bộ nhớ)
const crypto = require('crypto');
const db = require('../../core/db');
const { calculateEffectivePermissions } = require('./roleController');

const jwt = require('jsonwebtoken');
// Bắt buộc có JWT_SECRET ở production — không cho âm thầm dùng fallback yếu (fallback có trong code public).
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production — hãy đặt biến môi trường JWT_SECRET.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'mes_fallback_secret_key';

// ── Brute-force protection ────────────────────────────────────────────────────
// Đếm lần sai theo 3 khóa (trong cửa sổ 15 phút), chạm ngưỡng nào thì khóa 15 phút:
//  - tài khoản + IP : 5 lần  → người gõ sai chỉ khóa CHÍNH tài khoản đó trên máy đó
//                              (cả xưởng chung 1 Wi-Fi/1 IP không bị khóa lây).
//  - tài khoản      : 20 lần → chặn dò mật khẩu 1 tài khoản bằng cách đổi IP liên tục.
//  - IP             : 50 lần → chặn dò hàng loạt tài khoản từ 1 nơi.
const LOCK_MS = 15 * 60 * 1000; // cửa sổ đếm + thời gian khóa: 15 phút
const LIMITS = { userIp: 5, user: 20, ip: 50 };
const loginAttempts = new Map(); // key → { count, firstAt, lockedUntil }

function attemptKeys(ip, username) {
  const u = String(username || '').trim().toLowerCase();
  return [
    { key: `ui:${u}|${ip}`, max: LIMITS.userIp },
    { key: `u:${u}`,        max: LIMITS.user },
    { key: `ip:${ip}`,      max: LIMITS.ip },
  ];
}
function checkBruteForce(ip, username) {
  const now = Date.now();
  return attemptKeys(ip, username).some(({ key }) => {
    const e = loginAttempts.get(key);
    return !!(e && e.lockedUntil && now < e.lockedUntil);
  });
}
function recordFailedLogin(ip, username) {
  const now = Date.now();
  for (const { key, max } of attemptKeys(ip, username)) {
    let e = loginAttempts.get(key);
    // Hết cửa sổ 15 phút (hoặc hết khóa) → đếm lại từ đầu
    if (!e || (e.lockedUntil ? e.lockedUntil <= now : now - e.firstAt > LOCK_MS)) {
      e = { count: 0, firstAt: now, lockedUntil: null };
    }
    e.count++;
    if (e.count >= max) e.lockedUntil = now + LOCK_MS;
    loginAttempts.set(key, e);
  }
}
function clearFailedLogin(ip, username) {
  // Đăng nhập đúng → xóa đếm của tài khoản này (giữ đếm theo IP để vẫn chặn dò hàng loạt)
  const [ui, u] = attemptKeys(ip, username);
  loginAttempts.delete(ui.key);
  loginAttempts.delete(u.key);
}
// Dọn entries cũ mỗi giờ
setInterval(() => {
  const now = Date.now();
  for (const [key, e] of loginAttempts) {
    if (e.lockedUntil ? e.lockedUntil < now : now - e.firstAt > LOCK_MS) loginAttempts.delete(key);
  }
}, 60 * 60 * 1000);

// ── Password helpers ──────────────────────────────────────────────────────────
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  try { return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex')); } catch { return false; }
}

// ── User payload (không trả password_hash) ──────────────────────────────────
async function userPayload(id) {
  const { rows } = await db.query(`
    SELECT u.id, u.username, u.full_name, u.status, u.team, u.linked_worker,
           e.employee_code,
           r.id AS role_id, r.name AS role_name, COALESCE(r.is_admin, FALSE) AS is_admin, COALESCE(r.permissions, '{}'::jsonb) AS permissions
    FROM users u 
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN LATERAL (
      SELECT employee_code FROM employees
      WHERE name = u.linked_worker OR employee_code = u.linked_worker
      LIMIT 1
    ) e ON TRUE
    WHERE u.id = $1 AND u.is_deleted = FALSE`, [id]);
  const user = rows[0];
  if (user && user.role_id) {
    user.permissions = await calculateEffectivePermissions(user.role_id);
  }
  return user;
}

// ── Routes ───────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    const { username, password } = req.body || {};
    // Validate input cơ bản
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Cần nhập tài khoản và mật khẩu' });
    }

    // Kiểm tra brute-force (theo tài khoản + IP, tài khoản, IP)
    if (checkBruteForce(ip, username)) {
      return res.status(429).json({ message: 'Tài khoản tạm thời bị khóa do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.' });
    }

    const { rows } = await db.query(
      `SELECT * FROM users WHERE username = $1 AND is_deleted = FALSE`,
      [String(username).trim().slice(0, 100)]
    );
    const u = rows[0];
    if (!u || u.status !== 'Hoạt động' || !verifyPassword(password, u.password_hash)) {
      recordFailedLogin(ip, username);
      return res.status(401).json({ message: 'Sai tài khoản hoặc mật khẩu' });
    }

    clearFailedLogin(ip, username);
    // jti: mã riêng của phiên (để đăng xuất thu hồi đúng phiên này); tv: phiên bản mật khẩu (đổi mật khẩu → phiên cũ hết hạn)
    const token = jwt.sign({ userId: u.id, tv: u.token_version || 0, jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: await userPayload(u.id) });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi đăng nhập' }); }
};

exports.me = async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = exports.decodeToken(token);
  if (!payload || !(await exports.isSessionActive(payload))) {
    return res.status(401).json({ message: 'Phiên đăng nhập hết hạn' });
  }
  const user = await userPayload(payload.userId);
  if (!user) return res.status(401).json({ message: 'Tài khoản không tồn tại' });
  res.json({ user });
};

// Đăng xuất = thu hồi phiên này (jti) ngay, không đợi hết 8 giờ. Token cũ (trước bản này, không có jti) chỉ hết hạn tự nhiên.
exports.logout = async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = exports.decodeToken(token);
  if (payload?.jti && payload.exp) {
    try {
      await db.query(
        `INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES ($1, $2, to_timestamp($3)) ON CONFLICT (jti) DO NOTHING`,
        [payload.jti, payload.userId || null, payload.exp]);
      await db.query(`DELETE FROM revoked_tokens WHERE expires_at < now()`); // dọn phiên đã hết hạn
    } catch (e) { console.error('[logout] revoke', e.message); }
  }
  res.json({ message: 'Đã đăng xuất' });
};

// Phiên còn hiệu lực: chưa bị thu hồi (đăng xuất) và đúng phiên bản mật khẩu hiện tại.
// Gộp 1 truy vấn; dùng chung cho /auth/me và middleware requireAuth.
let warnedNoMigration = false;
exports.isSessionActive = async (payload, client = db) => {
  let rows;
  try {
    ({ rows } = await client.query(
      `SELECT u.token_version,
              EXISTS (SELECT 1 FROM revoked_tokens r WHERE r.jti = $2) AS revoked
       FROM users u WHERE u.id = $1`, [payload.userId, payload.jti || '']));
  } catch (e) {
    // Chưa chạy migrate (thiếu cột token_version / bảng revoked_tokens) → không chặn ai, chỉ cảnh báo 1 lần
    if (e.code === '42703' || e.code === '42P01') {
      if (!warnedNoMigration) { warnedNoMigration = true; console.warn('[auth] Chưa migrate token_version/revoked_tokens — thu hồi phiên đang TẮT. Chạy: npm run migrate'); }
      return true;
    }
    throw e;
  }
  if (!rows[0]) return false;
  if (rows[0].revoked) return false;
  return (Number(payload.tv) || 0) === (Number(rows[0].token_version) || 0);
};

exports.hashPassword = hashPassword;

// Giải mã + kiểm chữ ký/hạn token → payload { userId, tv, jti, exp } hoặc null
exports.decodeToken = (token) => {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload && payload.userId ? payload : null;
  } catch (err) {
    return null;
  }
};

// Verify token helper (giữ cho tương thích) → userId hoặc null
exports.verifyToken = (token) => exports.decodeToken(token)?.userId || null;

// Tạo tài khoản admin mặc định nếu DB chưa có user nào (kể cả chưa bị xóa)
exports.ensureSeedAdmin = async () => {
  try {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM users WHERE is_deleted = FALSE`);
    if (rows[0].n > 0) return;
    const role = (await db.query(`SELECT id FROM roles WHERE is_admin = TRUE LIMIT 1`)).rows[0];
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role_id) VALUES ($1,$2,$3,$4)`,
      ['admin', hashPassword('admin123'), 'Quản trị viên', role?.id || null]
    );
    console.log('✅ Đã tạo tài khoản mặc định: admin / admin123 (hãy đổi mật khẩu sau khi đăng nhập lần đầu)');
  } catch (e) { console.error('Seed admin lỗi:', e.message); }
};
