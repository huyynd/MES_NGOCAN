// Cổng NVL cho lệnh sản xuất "xuất NVL ngay khi yêu cầu" (plan 2026-11-25-nvl-xuat-ngay-lsx).
// NGUỒN DUY NHẤT của các quy tắc QT1–QT5 — mọi cửa vào gọi các hàm ở đây, không viết lại điều kiện tại chỗ.
// Lệnh cũ (nvl_strict = FALSE) luôn thoát sớm → hành vi như trước.

const { orderSources } = require('../../core/lib/materialReturns');

const { producedFromTasks } = require('../../core/lib/finalStage');
const { getAppSettings } = require('../../core/lib/settings');

const EPS = 0.001;

/** Lệnh theo luồng mới (cờ đặt khi tạo lệnh). */
function isNewFlow(order) {
  return !!(order && order.nvl_strict === true);
}

/** Câu QT3 (backend trả đúng câu này cho web + mobile). */
function gateMessage(orderCode) {
  return `Lệnh ${orderCode} chưa xuất NVL nên chưa ghi nhận sản lượng được. `
    + "Vào mục 'Nguyên vật liệu cần cung cấp' → nhập NVL → bấm 'Yêu cầu NVL'. "
    + "Xuất NVL xong lệnh sẽ chuyển sang 'Đang sản xuất' và bạn ghi nhận tiếp.";
}

/**
 * QT4 (thuần): mỗi NVL — Tiêu hao = (SL yêu cầu ban đầu ÷ SL lệnh) × SL đã SX; Còn lại = đã xuất − đã trả − tiêu hao.
 * Còn lại âm (vượt quá EPS) → hiện 0 + over = true. SL lệnh 0 / không có NVL → null (UI hiện "—").
 * @returns {null | Array<{product_id, consumed, remaining, over}>}
 */
function computeConsumption(order, perMaterial, producedQty) {
  const orderQty = Number(order && order.quantity) || 0;
  if (!(orderQty > 0) || !Array.isArray(perMaterial) || perMaterial.length === 0) return null;
  const produced = Number(producedQty) || 0;
  return perMaterial.map((m) => {
    const consumed = (Number(m.requested_initial) || 0) / orderQty * produced;
    const raw = (Number(m.issued) || 0) - (Number(m.returned) || 0) - consumed;
    const over = raw < -EPS;
    return { product_id: m.product_id, consumed, remaining: raw < EPS ? 0 : raw, over };
  });
}

/**
 * QT1: NVL đã xuất cho lệnh = phiếu NVL "Đã xuất" (phiếu "Đã đảo" tự bị loại) − đã trả (TNVL/DPX theo dòng nguồn).
 * KHÔNG dùng cờ materials_issued (cờ đó bật cả khi phiếu mới Chờ xuất).
 * @returns {{ issued: boolean, perMaterial: Array<{product_id, requested_initial, issued, returned}> }}
 */
async function getIssuedState(conn, orderId) {
  const sources = await orderSources(conn, orderId);
  const plan = (await conn.query(
    `SELECT material_id, SUM(requested_initial) AS requested_initial FROM production_order_materials
      WHERE production_order_id = $1 GROUP BY material_id ORDER BY MIN(created_at), material_id`, [orderId])).rows;
  const map = new Map();
  for (const p of plan) {
    map.set(p.material_id, { product_id: p.material_id, requested_initial: p.requested_initial == null ? null : Number(p.requested_initial), issued: 0, returned: 0 });
  }
  for (const r of sources) {
    const m = map.get(r.product_id) || { product_id: r.product_id, requested_initial: null, issued: 0, returned: 0 };
    m.issued += Number(r.issued_qty) || 0;
    m.returned += Number(r.returned_qty) || 0;
    map.set(r.product_id, m);
  }
  const perMaterial = [...map.values()];
  const issued = perMaterial.some((m) => m.issued - m.returned > EPS);
  return { issued, perMaterial };
}

/** SL đã SX = công đoạn cuối (cùng định nghĩa recomputeOrder — producedFromTasks). */
async function producedQtyLastStage(conn, orderId) {
  const ord = (await conn.query(
    `SELECT p.product_type, p.product_types FROM production_orders po LEFT JOIN products p ON p.id = po.product_id WHERE po.id = $1`, [orderId])).rows[0];
  if (!ord) return 0;
  const tks = (await conn.query(`SELECT stage, status, quantity, actual_qty FROM production_tasks WHERE production_order_id = $1`, [orderId])).rows;
  return producedFromTasks(ord, tks).produced;
}

/**
 * Ngưỡng "đủ sản lượng": lệnh mới = (100 − nvl_shortfall_percent)% SL lệnh (spec 10.1); lệnh cũ giữ 100%.
 * order cần { quantity, nvl_strict }.
 */
async function isQtyReached(conn, order, produced) {
  const qty = Number(order.quantity) || 0;
  if (!isNewFlow(order)) return produced >= qty;
  const pct = (await getAppSettings(conn)).nvl_shortfall_percent;
  return produced >= qty * (100 - pct) / 100 - EPS;
}

/**
 * QT5: lệnh mới chỉ Hoàn thành khi mọi NVL còn lại ≤ 0 (sai số EPS). Lệnh cũ luôn ok.
 * @returns {{ ok: boolean, left: Array<{product_id, remaining}> }} left = các NVL còn phải trả.
 */
async function canComplete(conn, order, produced) {
  if (!isNewFlow(order)) return { ok: true, left: [] };
  const made = produced == null ? await producedQtyLastStage(conn, order.id) : produced;
  const { perMaterial } = await getIssuedState(conn, order.id);
  const cons = computeConsumption(order, perMaterial, made) || [];
  const left = cons.filter((c) => c.remaining > EPS).map((c) => ({ product_id: c.product_id, remaining: c.remaining }));
  return { ok: left.length === 0, left };
}

/** Spec 10.7: phiếu xuất NVL của lệnh mới không đảo (DPX) — câu hướng dẫn dùng phiếu trả NVL. */
function reverseBlockedMessage(orderCode) {
  return `Phiếu này là NVL đã xuất cho lệnh ${orderCode} — không đảo phiếu được. `
    + `Muốn bớt NVL, mở lệnh ${orderCode} → mục 'Nguyên vật liệu' → lập phiếu trả NVL cho phần còn thừa.`;
}

/** Lỗi chặn của cổng NVL — controller trả 400 + câu QT3 (gateErrorResponse). */
class GateError extends Error {
  constructor(message) { super(message); this.name = 'GateError'; this.status = 400; }
}

// Trạng thái dòng phân công coi là "đang chạy" (cùng tập recomputeOrder dùng cho anyStarted, trừ Hoàn thành).
const RUN_TASK_STATUSES = new Set(['Đang sản xuất', 'Dừng sản xuất']);

/** Lệnh mới đã xuất NVL chưa (QT1). Lệnh cũ luôn true. order cần { id, nvl_strict }. */
async function hasIssuedMaterials(conn, order) {
  if (!isNewFlow(order)) return true;
  return (await getIssuedState(conn, order.id)).issued;
}

/** QT2: lệnh mới chưa xuất NVL không được vào "Đang sản xuất" / chạy dòng. order cần { id, order_code, nvl_strict }. */
async function assertCanRun(conn, order) {
  if (!isNewFlow(order)) return;
  // Spec 10.11: lệnh mới đã Hoàn thành → không dòng nào chạy thêm (web, mobile, lưu phân công, PUT).
  if (order.status === 'Hoàn thành') throw new GateError(completedRunMessage(order.order_code));
  if (!(await hasIssuedMaterials(conn, order))) throw new GateError(gateMessage(order.order_code));
}

/**
 * QT3: lệnh mới chỉ ghi sản lượng khi đang "Đang sản xuất" VÀ còn NVL đã xuất
 * (đảo phiếu DPX: lệnh giữ "Đang sản xuất" nhưng bị khóa tới khi Yêu cầu NVL lại).
 * order cần { id, order_code, status, nvl_strict }.
 */
async function isOutputBlocked(conn, order, state = null) {
  if (!isNewFlow(order)) return false;
  if (order.status !== 'Đang sản xuất') return true;
  return !(state ? state.issued : await hasIssuedMaterials(conn, order)); // state: getIssuedState đã đọc sẵn (tránh đọc 2 lần)
}
/** Câu chặn ghi SL khi lệnh mới đã Hoàn thành (R9) — không nói "chưa xuất NVL" gây hiểu nhầm. */
function completedMessage(orderCode) {
  return `Lệnh ${orderCode} đã hoàn thành nên không ghi nhận thêm sản lượng được. `
    + 'Nếu cần làm tiếp, nhờ Admin bấm "Hủy hoàn thành" ở dòng phân công của lệnh.';
}
/** Spec 10.11: câu chặn chạy dòng khi lệnh mới đã Hoàn thành. */
function completedRunMessage(orderCode) {
  return `Lệnh ${orderCode} đã hoàn thành nên không chạy thêm dòng phân công nào được. `
    + 'Nếu cần làm tiếp, nhờ Admin bấm "Hủy hoàn thành" ở dòng phân công của lệnh.';
}
async function assertCanRecordOutput(conn, order) {
  if (!(await isOutputBlocked(conn, order))) return;
  throw new GateError(order.status === 'Hoàn thành' ? completedMessage(order.order_code) : gateMessage(order.order_code));
}

/**
 * T13 — số cho màn chi tiết lệnh. Lệnh cũ → { materials_progress: null, gate_message: null }.
 * materials_progress: mỗi NVL { product_id, requested_initial, issued, returned, consumed, remaining, over }
 * (consumed/remaining/over = null khi SL lệnh 0 → UI hiện "—"). gate_message: câu QT3 khi bị khóa ghi SL
 * (lệnh Hoàn thành / Đã hủy → null: khóa vì lý do khác, không phải do NVL).
 * order cần { id, order_code, status, quantity, nvl_strict }.
 */
async function materialsProgress(conn, order) {
  if (!isNewFlow(order)) return { materials_progress: null, gate_message: null };
  const state = await getIssuedState(conn, order.id);
  const { perMaterial } = state;
  const cons = computeConsumption(order, perMaterial, await producedQtyLastStage(conn, order.id));
  const progress = perMaterial.map((m, i) => ({
    product_id: m.product_id, requested_initial: m.requested_initial, issued: m.issued, returned: m.returned,
    consumed: cons ? cons[i].consumed : null, remaining: cons ? cons[i].remaining : null, over: cons ? cons[i].over : null,
  }));
  const closed = order.status === 'Hoàn thành' || order.status === 'Đã hủy';
  const blocked = !closed && (await isOutputBlocked(conn, order, state));
  return { materials_progress: progress, gate_message: blocked ? gateMessage(order.order_code) : null };
}

/**
 * Danh sách NVL cần cung cấp chỉ nhận sản phẩm loại "Nguyên vật liệu" (product_types nếu có, không thì product_type —
 * cùng cách màn LSX lọc ô chọn NVL). Trả câu lỗi (→ 400) hoặc null. lines: [{ material_id }].
 */
const { isUuid } = require('../../core/lib/validate');
async function nonMaterialError(conn, lines) {
  const ids = [...new Set(lines.map((l) => String(l.material_id)))];
  if (!ids.length) return null;
  const badId = ids.find((id) => !isUuid(id));
  if (badId) return `Mã NVL "${badId}" không hợp lệ.`;
  const rows = (await conn.query(
    `SELECT id, product_code, product_name,
            CASE WHEN jsonb_array_length(COALESCE(product_types, '[]'::jsonb)) > 0 THEN product_types ? 'Nguyên vật liệu'
                 ELSE product_type = 'Nguyên vật liệu' END AS is_nvl
       FROM products WHERE id = ANY($1::uuid[])`, [ids])).rows;
  const found = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.find((id) => !found.has(id));
  if (missing) return 'Có NVL trong danh sách không còn tồn tại — tải lại trang rồi chọn lại.';
  const wrong = rows.filter((r) => !r.is_nvl);
  if (wrong.length) return `${wrong.map((r) => `${r.product_code} ${r.product_name}`).join(', ')} không phải nguyên vật liệu — chỉ chọn sản phẩm loại "Nguyên vật liệu".`;
  return null;
}

/** Hệ số quy về kg; null = đơn vị không quy được (không phải KG/GRAM). */
function kgFactor(unit) {
  const u = String(unit || '').trim().toUpperCase();
  return u === 'KG' ? 1 : u === 'GRAM' ? 0.001 : null;
}
const fmtKg = (n) => Number(n.toFixed(3)).toLocaleString('vi-VN');

/**
 * Trần NVL đầu vào (chủ dự án chốt): lệnh nvl_strict đơn vị KG/GRAM — tổng định mức NVL quy kg
 * (mỗi NVL lấy MAX(requested_initial, SL trong danh sách) = định mức sau lần yêu cầu/bổ sung kế tiếp)
 * ≤ nvl_max_input_percent % số kg cần sản xuất. Đọc danh sách ĐÃ GHI trong transaction (gọi sau replacePlannedLines).
 * NVL đơn vị không phải KG/GRAM: không cộng (chưa quy được kg). Trả câu lỗi (→ 400) hoặc null.
 * baseline (kg, tùy chọn) = tổng đang lưu TRƯỚC khi sửa danh sách: chủ dự án chốt — lệnh đã vượt trần từ trước chỉ bị chặn
 * khi tổng MỚI tăng so với baseline (giữ nguyên / giảm chưa đủ vẫn lưu được). Đổi SL / đơn vị lệnh: không truyền baseline.
 */
async function inputCapError(conn, orderId, { baseline = null } = {}) {
  const po = (await conn.query(`SELECT order_code, quantity, unit, nvl_strict FROM production_orders WHERE id = $1`, [orderId])).rows[0];
  if (!isNewFlow(po)) return null;
  return inputCapMessage(po, await storedCapRows(conn, orderId), (await getAppSettings(conn)).nvl_max_input_percent, baseline);
}
const storedCapRows = async (conn, orderId) => (await conn.query(
  `SELECT pom.qty, pom.requested_initial, COALESCE(NULLIF(pom.unit, ''), p.unit) AS unit
     FROM production_order_materials pom LEFT JOIN products p ON p.id = pom.material_id
    WHERE pom.production_order_id = $1`, [orderId])).rows;

/** Tổng kg NVL (định mức) — mỗi dòng MAX(qty, requested_initial) quy kg; đơn vị không quy được thì bỏ qua. */
function inputKgTotal(rows) {
  let total = 0;
  for (const r of rows) {
    const k = kgFactor(r.unit);
    if (k == null) continue;
    total += Math.max(Number(r.qty) || 0, Number(r.requested_initial) || 0) * k;
  }
  return total;
}
/** Tổng kg NVL đang lưu của lệnh (baseline trước khi sửa danh sách). */
const storedInputKg = async (conn, orderId) => inputKgTotal(await storedCapRows(conn, orderId));

/**
 * Lõi thuần của trần NVL (MỘT định nghĩa cho lưu danh sách, yêu cầu NVL, đổi SL lệnh, kiểm trước khi lưu).
 * po { order_code, quantity, unit } (lệnh nvl_strict); rows [{ qty, requested_initial, unit }]; pct = nvl_max_input_percent.
 * baseline: xem inputCapError — tổng không tăng so với baseline thì không chặn.
 */
function inputCapMessage(po, rows, pct, baseline = null) {
  const f = kgFactor(po.unit);
  if (f == null) return null;
  const total = inputKgTotal(rows);
  const max = (Number(po.quantity) || 0) * f * pct / 100;
  if (total <= max + EPS) return null;
  if (baseline != null && total <= baseline + EPS) return null;
  return `Tổng NVL của lệnh${po.order_code ? ' ' + po.order_code : ''} là ${fmtKg(total)} kg, vượt mức tối đa ${fmtKg(max)} kg `
    + `(${pct}% số kg cần sản xuất). Hãy giảm số kg NVL trong danh sách.`;
}

/**
 * Kiểm trần TRƯỚC khi lưu (màn LSX gọi trước Lưu lệnh — tránh lệnh đã lưu mà danh sách NVL bị từ chối).
 * orderId null = lệnh mới (luôn nvl_strict). Lệnh đang sửa: định mức mỗi NVL = MAX(SL mới, requested_initial đã có).
 * lines [{ material_id, qty, unit }]; unit dòng rỗng → đơn vị sản phẩm.
 */
async function previewInputCap(conn, { orderId = null, quantity, unit, lines }) {
  let code = null; let ri = new Map(); let baseline = null;
  if (orderId) {
    const po = (await conn.query(`SELECT order_code, nvl_strict, quantity, unit FROM production_orders WHERE id = $1 AND is_deleted = FALSE`, [orderId])).rows[0];
    if (!po || !isNewFlow(po)) return null;
    code = po.order_code;
    // Giữ SL + đơn vị: theo quy tắc "chỉ chặn khi tổng tăng" (baseline = tổng đang lưu). Đổi SL / đơn vị: chặn như update.
    const sameQty = Number(quantity) === Number(po.quantity) && (String(unit || '').trim().toUpperCase()) === (String(po.unit || '').trim().toUpperCase());
    if (sameQty) baseline = await storedInputKg(conn, orderId);
    ri = new Map((await conn.query(
      `SELECT material_id, SUM(requested_initial) AS ri FROM production_order_materials WHERE production_order_id = $1 GROUP BY material_id`, [orderId])).rows
      .map((r) => [r.material_id, Number(r.ri) || 0]));
  }
  const ids = [...new Set(lines.map((l) => String(l.material_id)).filter((x) => isUuid(x)))];
  const pu = new Map((await conn.query(`SELECT id, unit FROM products WHERE id = ANY($1::uuid[])`, [ids])).rows.map((r) => [r.id, r.unit]));
  const seen = new Set();
  const rows = lines.map((l) => { seen.add(l.material_id); return { qty: l.qty, requested_initial: ri.get(l.material_id) || 0, unit: l.unit || pu.get(l.material_id) }; });
  // NVL đã có định mức mà không nằm trong danh sách gửi lên vẫn được giữ (R1) → vẫn tính
  for (const [mid, v] of ri) if (!seen.has(mid) && v > 0) {
    const u = (await conn.query(`SELECT COALESCE(NULLIF(pom.unit, ''), p.unit) AS unit FROM production_order_materials pom LEFT JOIN products p ON p.id = pom.material_id
      WHERE pom.production_order_id = $1 AND pom.material_id = $2 LIMIT 1`, [orderId, mid])).rows[0]?.unit;
    rows.push({ qty: 0, requested_initial: v, unit: u });
  }
  return inputCapMessage({ order_code: code, quantity, unit }, rows, (await getAppSettings(conn)).nvl_max_input_percent, baseline);
}

/** Gọi trong catch của controller (sau ROLLBACK): GateError → 400, trả true. */
function gateErrorResponse(res, err) {
  if (!(err instanceof GateError)) return false;
  res.status(err.status).json({ message: err.message });
  return true;
}

module.exports = {
  EPS, isNewFlow, gateMessage, completedMessage, completedRunMessage, reverseBlockedMessage, computeConsumption, getIssuedState, producedQtyLastStage, isQtyReached, canComplete,
  GateError, RUN_TASK_STATUSES, hasIssuedMaterials, assertCanRun, assertCanRecordOutput, gateErrorResponse, materialsProgress,
  nonMaterialError, inputCapError, inputCapMessage, previewInputCap, storedInputKg,
};
