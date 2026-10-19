// backend/lib/deleteGuard.js
// Quy tắc chung: KHÔNG xóa cứng — chỉ soft delete (is_deleted), và KHÔNG cho xóa
// khi bản ghi đang ở trạng thái Hoạt động / đang tiến hành. Phải đổi sang trạng thái
// kết thúc (Không hoạt động / Đã hủy / Đã nghỉ / Ngừng…) rồi mới xóa được.
// F2: ngoài trạng thái, còn kiểm PHỤ THUỘC THẬT (còn tồn, đơn/LSX chưa xong, BOM…) qua `dependents`.
const db = require('../db');
const { upUnit } = require('./units');

/**
 * findDependent(id, dependents)
 *   dependents: [{ sql, message }] — sql nhận $1 = id; trả ≥ 1 dòng nghĩa là ĐANG ĐƯỢC DÙNG → chặn xóa.
 *               message: chuỗi, hoặc hàm (rows) => chuỗi (để ghi rõ mã chứng từ / số tồn).
 * Trả về thông báo chặn đầu tiên, hoặc null nếu không vướng gì.
 */
async function findDependent(id, dependents = []) {
  for (const d of dependents) {
    const { rows } = await db.query(d.sql, [id]);
    if (rows.length) return typeof d.message === 'function' ? d.message(rows) : d.message;
  }
  return null;
}

/**
 * guardDelete(table, id, opts)
 *   blocked    : mảng trạng thái KHÔNG cho xóa (chặn nếu status nằm trong đây)
 *   allow      : (tùy chọn) chỉ cho xóa khi status nằm trong đây (ngược lại đều chặn)
 *   message    : thông báo lỗi tùy biến
 *   dependents : (tùy chọn) kiểm phụ thuộc — xem findDependent
 * Trả về: { notFound } | { blocked, status, message } | { ok }
 */
async function guardDelete(table, id, opts = {}) {
  const { blocked = [], allow = null, message, statusCol = 'status', dependents = [] } = opts;
  const r = await db.query(`SELECT ${statusCol} AS st FROM ${table} WHERE id = $1 AND is_deleted = FALSE`, [id]);
  if (!r.rows.length) return { notFound: true };
  const st = r.rows[0].st;
  const isBlocked = allow ? !allow.includes(st) : blocked.includes(st);
  if (isBlocked) {
    return {
      blocked: true, status: st,
      message: message || `Không thể xóa khi đang "${st}". Chỉ xóa được khi đã chuyển sang trạng thái kết thúc (Không hoạt động / Đã hủy / Ngừng). Vui lòng đổi trạng thái trước.`,
    };
  }
  const dep = await findDependent(id, dependents);
  if (dep) return { blocked: true, status: st, message: dep };
  return { ok: true };
}

// ── Danh sách phụ thuộc dùng chung ─────────────────────────────────────────────
const fmtQty = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const codes = (rows, col = 'code') => {
  const list = rows.map((r) => r[col]).filter(Boolean);
  return list.slice(0, 5).join(', ') + (list.length > 5 ? `… (+${list.length - 5})` : '');
};
const SETTING_LABELS = {
  roll_product_id: 'Sản phẩm cuộn mặc định (Thổi)',
  default_material_product_id: 'NVL mặc định của LSX',
  recycled_pe_product_id: 'Sản phẩm nhận cuộn PE tái chế',
};
// Tồn còn lại (chỉ tính vị trí/kho chưa xóa — cùng phạm vi màn Tồn kho, để người dùng xử lý được)
const stockMsg = (what) => (rows) =>
  `Không thể xóa: ${what} còn tồn ${rows.map((r) => `${fmtQty(r.qty)} ${upUnit(r.unit) || ''}`.trim()).join(' + ')}. ` +
  'Hãy xuất / chuyển / điều chỉnh tồn về 0 trước rồi mới xóa.';
// Gộp theo đơn vị chuẩn hóa (KG = Kg) — đơn vị dòng tồn, thiếu thì lấy đơn vị SP
const STOCK_BY_UNIT = (cond) => `
  SELECT MIN(COALESCE(NULLIF(s.unit, ''), p.unit)) AS unit, SUM(s.quantity) AS qty
  FROM inventory_stock s
  JOIN products p ON p.id = s.product_id
  LEFT JOIN locations l ON l.id = s.location_id
  LEFT JOIN warehouses w ON w.id = l.warehouse_id
  WHERE ${cond} AND COALESCE(l.is_deleted, FALSE) = FALSE AND COALESCE(w.is_deleted, FALSE) = FALSE
  GROUP BY UPPER(TRIM(COALESCE(NULLIF(s.unit, ''), p.unit, ''))) HAVING SUM(s.quantity) > 0`;
const PENDING_SLIPS = (cond) => ({
  sql: `SELECT os.slip_code AS code FROM outbound_slips os JOIN locations l ON l.id = os.location_id
        WHERE ${cond} AND os.status = 'Chờ xuất' ORDER BY os.slip_code`,
  message: (rows) => `Không thể xóa: còn phiếu xuất kho "Chờ xuất" tại đây (${codes(rows)}). Hãy xác nhận hoặc hủy phiếu trước.`,
});

const PRODUCT_DEPENDENTS = [
  { sql: STOCK_BY_UNIT('s.product_id = $1'), message: stockMsg('sản phẩm') },
  {
    sql: `SELECT DISTINCT so.order_code AS code FROM sales_order_items it JOIN sales_orders so ON so.id = it.sales_order_id
          WHERE it.product_id = $1 AND so.is_deleted = FALSE AND so.status NOT IN ('Hoàn thành', 'Đã hủy') ORDER BY 1`,
    message: (rows) => `Không thể xóa: sản phẩm đang có trong đơn hàng chưa xong (${codes(rows)}).`,
  },
  {
    sql: `SELECT DISTINCT po.order_code AS code FROM production_orders po
          LEFT JOIN production_order_materials pom ON pom.production_order_id = po.id
          WHERE (po.product_id = $1 OR pom.material_id = $1)
            AND po.is_deleted = FALSE AND po.status NOT IN ('Hoàn thành', 'Đã hủy') ORDER BY 1`,
    message: (rows) => `Không thể xóa: sản phẩm đang dùng ở lệnh sản xuất chưa xong (${codes(rows)}).`,
  },
  {
    sql: `SELECT DISTINCT b.bom_code AS code FROM boms b LEFT JOIN bom_lines bl ON bl.bom_id = b.id
          WHERE (b.product_id = $1 OR bl.material_id = $1) AND b.is_deleted = FALSE ORDER BY 1`,
    message: (rows) => `Không thể xóa: sản phẩm đang có trong BOM (${codes(rows)}). Hãy xóa BOM hoặc bỏ sản phẩm khỏi BOM trước.`,
  },
  {
    sql: `SELECT key FROM app_settings WHERE value = to_jsonb($1::text)`,
    message: (rows) => `Không thể xóa: sản phẩm đang được chọn làm "${rows.map((r) => SETTING_LABELS[r.key] || r.key).join('", "')}" trong cài đặt hệ thống. Hãy đổi sang sản phẩm khác trước.`,
  },
];

const WAREHOUSE_DEPENDENTS = [
  { sql: STOCK_BY_UNIT('l.warehouse_id = $1'), message: stockMsg('kho') },
  PENDING_SLIPS('l.warehouse_id = $1'),
];

const LOCATION_DEPENDENTS = [
  { sql: STOCK_BY_UNIT('s.location_id = $1'), message: stockMsg('vị trí') },
  PENDING_SLIPS('os.location_id = $1'),
];

// Nhân viên: công việc được phân công (theo tên) chưa xong ở lệnh chưa xong
const EMPLOYEE_DEPENDENTS = [
  {
    sql: `SELECT t.task_code AS code FROM production_tasks t
          JOIN production_orders po ON po.id = t.production_order_id
          JOIN employees e ON e.name = t.assigned_worker
          WHERE e.id = $1 AND po.is_deleted = FALSE AND po.status NOT IN ('Hoàn thành', 'Đã hủy')
            AND t.status IN ('Chờ', 'Đang sản xuất', 'Dừng sản xuất') ORDER BY 1`,
    message: (rows) => `Không thể xóa: nhân viên còn công việc sản xuất chưa xong (${codes(rows)}). Hãy phân công người khác trước.`,
  },
];

module.exports = {
  guardDelete, findDependent,
  PRODUCT_DEPENDENTS, WAREHOUSE_DEPENDENTS, LOCATION_DEPENDENTS, EMPLOYEE_DEPENDENTS,
};
