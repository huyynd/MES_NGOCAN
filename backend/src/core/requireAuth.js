// backend/middleware/requireAuth.js — xác thực Bearer token cho mọi request
const { decodeToken, isSessionActive } = require('../modules/auth/authController');
const { calculateEffectivePermissions } = require('../modules/auth/roleController');
const db = require('./db');
const { runWithUser } = require('./requestContext');

/**
 * Middleware xác thực phiên đăng nhập.
 * Gắn req.userId và req.user vào request nếu token hợp lệ.
 * Trả 401 nếu thiếu/sai/hết hạn token.
 */
module.exports = async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Cần đăng nhập để thực hiện thao tác này' });

  const payload = decodeToken(token);
  if (!payload) return res.status(401).json({ message: 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại' });
  const userId = payload.userId;

  try {
    // Phiên đã đăng xuất / tài khoản đã đổi mật khẩu → hết hiệu lực ngay
    if (!(await isSessionActive(payload))) {
      return res.status(401).json({ message: 'Phiên đăng nhập đã kết thúc, vui lòng đăng nhập lại' });
    }
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.full_name, u.status, u.team, u.linked_worker,
              COALESCE(u.permissions, '{}'::jsonb) AS user_permissions,
              r.id AS role_id, r.name AS role_name,
              COALESCE(r.is_admin, FALSE) AS is_admin
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.is_deleted = FALSE AND u.status = 'Hoạt động'`,
      [userId]
    );
    if (!rows[0]) return res.status(401).json({ message: 'Tài khoản không tồn tại hoặc đã bị vô hiệu hóa' });

    req.userId = userId;
    req.user   = rows[0];
    
    // Tính quyền hiệu lực (kế thừa từ role cha)
    let rolePerms = {};
    if (req.user.role_id) {
      rolePerms = await calculateEffectivePermissions(req.user.role_id);
    }

    // Merge quyền riêng của user (ghi đè/bổ sung lên quyền của role)
    const customPerms = req.user.user_permissions || {};
    const merged = JSON.parse(JSON.stringify(rolePerms));
    
    Object.keys(customPerms).forEach(mod => {
      if (!merged[mod]) merged[mod] = {};
      Object.keys(customPerms[mod]).forEach(act => {
        merged[mod][act] = customPerms[mod][act];
      });
    });
    
    req.user.permissions = merged;
    // K-16: phần còn lại của request chạy trong ngữ cảnh user → sổ cái kho ghi được người thực hiện
    runWithUser({ id: req.user.id, name: req.user.full_name || req.user.username }, next);
  } catch (err) {
    console.error('[requireAuth]', err);
    res.status(500).json({ message: 'Lỗi xác thực, vui lòng thử lại' });
  }
};

/**
 * Middleware phân quyền (RBAC).
 * Cần đặt sau requireAuth.
 * Kiểm tra xem user có phải admin, hoặc có quyền được cấu hình không.
 */
module.exports.requirePerm = (permString) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Chưa xác thực' });
    if (req.user.is_admin) return next();
    
    // permString format: "module:action" e.g., "engineering:edit" or "products:edit"
    // Backward compatibility: map old string to new apps if needed
    let moduleKey = permString;
    let action = 'view';
    
    if (permString.includes(':')) {
      const parts = permString.split(':');
      moduleKey = parts[0];
      action = parts[1];
    }
    
    // Map old backend perm strings to new frontend app keys
    const appMap = {
      'engineering': ['products', 'bom', 'process'],
      'sales':       ['orders', 'deliveries'],
      'production':  ['production', 'planning', 'workschedule', 'work_schedules', 'execution', 'orderstatus', 'prod_output'],
      'inventory':   ['inventory', 'inv_inbound', 'inv_outbound', 'inv_transfer', 'inv_adjust'],
      'trace':       ['qrscan', 'trace_lot'],
      'reports':     ['reports', 'rep_inv'],
      // Danh mục: mỗi module có key riêng; 'sys' map toàn bộ danh mục
      'sys':         ['md_machines', 'md_employees', 'md_shifts', 'md_warehouses', 'md_locations', 'md_customers', 'md_roles', 'masterdata'],
      // Alias trực tiếp (khi backend dùng key cụ thể)
      'md_machines':  ['md_machines'],
      'md_employees': ['md_employees'],
      'md_shifts':    ['md_shifts'],
      'md_warehouses':['md_warehouses'],
      'md_locations': ['md_locations'],
      'md_customers': ['md_customers'],
      'md_roles':     ['md_roles'],
    };
    
    const possibleModules = appMap[moduleKey] || [moduleKey];
    
    let hasPerm = false;
    for (const mod of possibleModules) {
       const modPerms = req.user.permissions && req.user.permissions[mod];
       if (modPerms) {
           // New format: modPerms[action] is an object { status: 'ALLOW', scope: '...' }
           // Intermediate format: modPerms[action] is 'ALLOW', 'DENY', 'INHERIT'
           // Old format: modPerms[action] is boolean true/false
           const pval = modPerms[action];
           if (pval) {
             if (typeof pval === 'object' && pval.status === 'ALLOW') {
               hasPerm = true;
               break;
             } else if (pval === 'ALLOW' || pval === true) {
               hasPerm = true;
               break;
             }
           }
       }
    }
    // Backward comp fallback: if user has literal permission
    if (!hasPerm && req.user.permissions && req.user.permissions[permString] === true) {
       hasPerm = true;
    }

    if (hasPerm) return next();
    res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
  };
};

/**
 * Có quyền `action` trên đúng app key của web (vd 'md_customers', 'orders') không — cùng cách
 * frontend `can(app, action)` trong src/perm.jsx (admin luôn có; 'ALLOW' | true | {status:'ALLOW'}).
 */
function hasAppPerm(req, app, action) {
  if (req.user?.is_admin) return true;
  const v = req.user?.permissions?.[app]?.[action];
  return v === 'ALLOW' || v === true || v?.status === 'ALLOW';
}
module.exports.hasAppPerm = hasAppPerm;

/**
 * Middleware: cho qua nếu có ÍT NHẤT MỘT cặp [app, action]. Dùng app key của web (khớp menu / nút).
 * vd requireAnyPerm(['orders', 'view'], ['deliveries', 'view'])
 */
module.exports.requireAnyPerm = (...pairs) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Chưa xác thực' });
  if (pairs.some(([app, action]) => hasAppPerm(req, app, action))) return next();
  res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này' });
};
