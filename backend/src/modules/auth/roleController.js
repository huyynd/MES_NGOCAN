const db = require('../../core/db');

// Merge permissions: child overrides parent
function mergePermissions(parentPerms, childPerms) {
  const merged = JSON.parse(JSON.stringify(parentPerms || {}));
  const child = childPerms || {};

  for (const appKey of Object.keys(child)) {
    if (!merged[appKey]) merged[appKey] = {};
    const pApp = merged[appKey];
    const cApp = child[appKey];

    // Handle old boolean style or new style actions
    // Sửa 2026-10-26: gộp MỌI action (trừ 'fields') thay vì danh sách cứng — danh sách cũ làm mất
    // publish / request / confirm (và approve_correction của HR-G3) khi lưu vai trò.
    for (const action of Object.keys(cApp).filter((k) => k !== 'fields')) {
      if (cApp[action] !== undefined) {
        if (cApp[action] === 'INHERIT' || cApp[action] === '') {
           // inherit: do nothing, keep parent
        } else {
           pApp[action] = cApp[action]; // OVERRIDE (ALLOW, DENY, true, false)
        }
      }
    }
    
    // Merge fields
    if (cApp.fields) {
      if (!pApp.fields) pApp.fields = {};
      for (const field of Object.keys(cApp.fields)) {
        if (cApp.fields[field] !== 'INHERIT' && cApp.fields[field] !== '') {
          pApp.fields[field] = cApp.fields[field];
        }
      }
    }
  }
  return merged;
}

exports.calculateEffectivePermissions = async (roleId) => {
  if (!roleId) return {};
  const { rows } = await db.query('SELECT id, parent_id, permissions FROM roles WHERE is_deleted = FALSE');
  const roleMap = new Map();
  rows.forEach(r => roleMap.set(r.id, r));

  const chain = [];
  let currentId = roleId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    const role = roleMap.get(currentId);
    if (!role) break;
    chain.push(role);
    visited.add(currentId);
    currentId = role.parent_id;
  }
  
  // chain is [child, parent, grandparent]
  // we want to merge from top to bottom: grandparent -> parent -> child
  chain.reverse();
  
  let effectivePerms = {};
  for (const role of chain) {
    effectivePerms = mergePermissions(effectivePerms, role.permissions);
  }
  return effectivePerms;
};

exports.savePermissions = async (req, res) => {
  try {
    const perms = req.body.permissions || {};
    const parentId = req.body.parent_id || null;
    const { rows } = await db.query(
      `UPDATE roles SET permissions = $1::jsonb, parent_id = $2 WHERE id = $3 AND is_deleted = FALSE RETURNING id`,
      [JSON.stringify(perms), parentId, req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy vai trò' });
    res.json({ message: 'Đã lưu phân quyền' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lưu phân quyền' }); }
};

exports.getEffectivePermissions = async (req, res) => {
  try {
    const perms = await exports.calculateEffectivePermissions(req.params.id);
    res.json(perms);
  } catch (err) {
    console.error(err); res.status(500).json({ message: 'Lỗi tính toán quyền hiệu lực' });
  }
};
