// backend/controllers/productionController.js
const db = require('../../core/db');
const { buildSpecKey, legacyAttrs, specsFromBody, cleanSpecs } = require('../../core/lib/specs');
const { upUnit } = require('../../core/lib/units');
const { guardDelete } = require('../../core/lib/deleteGuard');
const { getDataScope } = require('../../core/dataScope');
const { applyStock } = require('../../core/lib/stock');

// Công đoạn cuối của 1 lệnh: 'Cắt' nếu có task Cắt, ngược lại 'Thổi'
const FINAL_STAGE = `(CASE WHEN EXISTS (SELECT 1 FROM production_tasks tf WHERE tf.production_order_id = po.id AND tf.stage = 'Cắt') THEN 'Cắt' ELSE 'Thổi' END)`;

// GET /api/production/machine-availability — độ sẵn sàng của máy (tải công việc chưa hoàn thành)
exports.machineAvailability = async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT m.id, m.name, m.factory, m.machine_type, m.status,
        (SELECT COUNT(*)::int FROM production_tasks t
           WHERE t.machine_id = m.id AND t.status NOT IN ('Hoàn thành','Đã hủy')) AS load
      FROM machines m WHERE m.is_deleted = FALSE
      ORDER BY m.factory, m.name`);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi kiểm tra máy' }); }
};

// GET /api/machines/:id/orders — các phân công/lệnh đã chạy trên 1 máy (chỉ xem)
exports.byMachine = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT t.id, t.stage, t.quantity, t.status, t.planned_date, t.shift,
             po.id AS production_order_id, po.order_code, p.product_code, p.product_name
      FROM production_tasks t
      JOIN production_orders po ON po.id = t.production_order_id AND po.is_deleted = FALSE
      LEFT JOIN products p ON p.id = po.product_id
      WHERE t.machine_id = $1
      ORDER BY t.planned_date DESC NULLS LAST, po.order_code`, [req.params.id]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy lệnh theo máy' }); }
};

const SELECT_JOIN = `
  SELECT po.*,
         p.product_name, p.product_code, p.product_type,
         c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
         m.name AS machine_name, m.factory AS machine_factory,
         so.order_code AS sales_order_code,
         (SELECT COUNT(*)::int FROM production_tasks t WHERE t.production_order_id = po.id) AS task_count,
         (SELECT COUNT(*)::int FROM production_tasks t WHERE t.production_order_id = po.id AND t.status = 'Hoàn thành') AS task_done,
         COALESCE((SELECT SUM(COALESCE(t.actual_qty, t.quantity)) FROM production_tasks t
                   WHERE t.production_order_id = po.id AND t.status = 'Hoàn thành'
                     AND t.stage = ${FINAL_STAGE}), 0) AS produced_qty,
         COALESCE((SELECT SUM(t.scrap_qty) FROM production_tasks t WHERE t.production_order_id = po.id), 0) AS scrap_qty,
         COALESCE((SELECT MIN(t.planned_date) FROM production_tasks t WHERE t.production_order_id = po.id AND t.planned_date IS NOT NULL), po.planned_date) AS start_date,
         -- Máy hiển thị: danh sách các máy từ tasks, fallback về machine_id của lệnh
         COALESCE(
           (SELECT STRING_AGG(DISTINCT m2.name, ', ') FROM production_tasks t2
            JOIN machines m2 ON m2.id = t2.machine_id
            WHERE t2.production_order_id = po.id AND t2.machine_id IS NOT NULL),
           m.name
         ) AS machine_name_display,
         -- Ngày SX hiển thị: ưu tiên ngày nhỏ nhất từ tasks, fallback về planned_date của lệnh
         COALESCE(
           (SELECT MIN(t3.planned_date) FROM production_tasks t3
            WHERE t3.production_order_id = po.id AND t3.planned_date IS NOT NULL),
           po.planned_date
         ) AS planned_date_display,
         -- Ca hiển thị: gộp danh sách các ca từ tasks, fallback về shift của lệnh
         COALESCE(
           NULLIF((SELECT STRING_AGG(DISTINCT t4.shift, ', ') FROM production_tasks t4
            WHERE t4.production_order_id = po.id AND t4.shift IS NOT NULL AND t4.shift != ''), ''),
           po.shift
         ) AS shift_display,
         COALESCE(
           NULLIF((SELECT STRING_AGG(DISTINCT t5.assigned_team, ', ') FROM production_tasks t5
            WHERE t5.production_order_id = po.id AND t5.assigned_team IS NOT NULL AND t5.assigned_team != ''), ''),
           po.assigned_team
         ) AS assigned_team_display
  FROM production_orders po
  JOIN products p   ON p.id = po.product_id
  LEFT JOIN customers c ON c.id = po.customer_id
  LEFT JOIN machines  m ON m.id = po.machine_id
  LEFT JOIN sales_orders so ON so.id = po.sales_order_id
`;

// L59: SL thực / SL phế của một lần phải là số ≥ 0 (rỗng/null = chưa nhập → bỏ qua).
// Số âm làm backflush trừ kho (delta âm), lách được trần 150% và làm sai báo cáo phế/KPI.
// Trả về thông báo lỗi, hoặc null nếu hợp lệ.
function invalidTaskQty(t, prefix = '') {
  for (const [k, label] of [['actual_qty', 'SL thực'], ['scrap_qty', 'SL phế']]) {
    const v = t[k];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return `${prefix}${label} phải là số ≥ 0 (nhận: ${v}).`;
  }
  return null;
}

// M04: chuyển trạng thái lệnh SX được phép (đặt tay qua PUT). "Đã hủy" là trạng thái cuối.
const PO_TRANSITIONS = {
  'Chờ duyệt':           ['Đã lên kế hoạch', 'Chờ nguyên vật liệu', 'Đang sản xuất', 'Hoàn thành', 'Đã hủy'],
  'Đã lên kế hoạch':     ['Chờ duyệt', 'Chờ nguyên vật liệu', 'Đang sản xuất', 'Hoàn thành', 'Đã hủy'],
  'Chờ nguyên vật liệu': ['Chờ duyệt', 'Đã lên kế hoạch', 'Đang sản xuất', 'Hoàn thành', 'Đã hủy'],
  'Đang sản xuất':       ['Chờ duyệt', 'Đã lên kế hoạch', 'Chờ nguyên vật liệu', 'Hoàn thành', 'Đã hủy'],
  'Hoàn thành':          ['Đang sản xuất', 'Đã hủy'],
  'Đã hủy':              [],
};
// Trạng thái "chưa sản xuất / huỷ": lệnh đã có sản lượng nhập kho không được chuyển về (sẽ treo tồn đã nhập).
const PO_NO_STOCK_STATUSES = new Set(['Chờ duyệt', 'Đã lên kế hoạch', 'Đã hủy']);

// L57: lệnh đã có sản lượng nhập kho chưa (theo từng lần — posted_qty của production_tasks).
async function hasPostedStock(conn, poId) {
  const r = await conn.query(
    `SELECT COALESCE(SUM(posted_qty), 0) AS s FROM production_tasks WHERE production_order_id = $1`, [poId]);
  return Number(r.rows[0].s) > 0;
}

// ===== GHI KHO THEO SỰ KIỆN (thiết kế cuộn BTP — xem docs/ai/plans/2026-10-08-thiet-ke-cuon-btp.md) =====
// Thổi hoàn thành → nhập cuộn vào BTP. Cắt hoàn thành → trừ cuộn BTP (FIFO, ưu tiên lô của lệnh) + nhập bao bì TP.
// Chỉ ghi khi một dòng CHUYỂN sang Hoàn thành mà posted_qty = 0. Dòng hoàn thành bị khóa nên không ghi lại.

// Mã cuộn chung (SP-PE-TC) lấy từ app_settings.roll_product_id (jsonb chứa chuỗi uuid)
async function getRollProductId(client) {
  const r = await client.query(`SELECT value FROM app_settings WHERE key = 'roll_product_id'`);
  const v = r.rows[0]?.value;
  return v == null ? null : String(v);
}

// Sản phẩm cuộn mà một dòng Thổi sẽ nhập ra (ô "Sản phẩm đầu ra"):
//  - task.output_product_id nếu có; ngược lại mặc định: SP của lệnh nếu lệnh là BTP, không thì mã cuộn cấu hình.
async function resolveBlowOutput(client, po, task) {
  if (task.output_product_id) return task.output_product_id;
  if (po.product_type === 'Bán thành phẩm') return po.product_id;
  // Lệnh chỉ có Thổi (không có Cắt, vd SP vừa TP vừa BTP bán dạng cuộn) → cuộn chính là SP của lệnh
  const cut = await client.query(
    `SELECT 1 FROM production_tasks WHERE production_order_id = $1 AND stage = 'Cắt' LIMIT 1`, [po.id]);
  if (!cut.rows.length) return po.product_id;
  const roll = await getRollProductId(client);
  if (!roll) throw new Error('Chưa cấu hình sản phẩm cuộn mặc định (app_settings.roll_product_id) và dòng Thổi chưa chọn Sản phẩm đầu ra.');
  return roll;
}

// Sản phẩm cuộn mà lệnh này CẮT (trừ ở BTP) = sản phẩm đầu ra của các dòng Thổi trong lệnh (distinct).
// Lệnh chỉ-Cắt (không có Thổi) → dùng mã cuộn cấu hình mặc định.
async function resolveCutRollProduct(client, po) {
  const r = await client.query(
    `SELECT DISTINCT output_product_id FROM production_tasks
     WHERE production_order_id = $1 AND stage = 'Thổi' AND output_product_id IS NOT NULL`, [po.id]);
  if (r.rows.length === 1) return r.rows[0].output_product_id;
  if (r.rows.length > 1) throw new Error('Các dòng Thổi có "Sản phẩm đầu ra" khác nhau — không xác định được cuộn để cắt. Hãy để các dòng Thổi cùng một sản phẩm.');
  const roll = await getRollProductId(client);
  if (!roll) throw new Error('Lệnh không có dòng Thổi và chưa cấu hình sản phẩm cuộn mặc định (app_settings.roll_product_id).');
  return roll;
}

// Location đầu tiên của một loại kho
async function locOf(client, whType) {
  return (await client.query(
    `SELECT l.id FROM locations l JOIN warehouses w ON w.id = l.warehouse_id
     WHERE w.warehouse_type = $1 AND l.is_deleted = FALSE ORDER BY l.created_at LIMIT 1`, [whType])).rows[0]?.id || null;
}

// Nhãn thông số dễ đọc cho thông báo lỗi ("60×40 · 2 dem · Trắng")
function specLabel(specs) {
  const vals = Object.values(cleanSpecs(specs || {}));
  return vals.length ? vals.join(' · ') : '(không có thông số)';
}

/**
 * Ghi kho khi MỘT dòng phân công chuyển sang Hoàn thành (posted_qty = 0 → chưa ghi).
 * @param po   { id, order_code, product_id, product_type, unit, product_code, specs }
 * @param task { id, task_code, stage, actual_qty }
 * @param finishLots  danh sách lô cuộn "đã hết cuộn" (chỉ dùng cho Cắt)
 * Trả về số kg đầu ra (để cộng dồn posted_qty cấp lệnh). Ném lỗi nếu thiếu kho/thiếu cuộn → rollback.
 */
async function postTaskStock(client, po, task, finishLots = []) {
  const q = Number(task.actual_qty);
  if (!(q > 0)) throw new Error(`Lần ${task.task_code} (${task.stage}): chưa có SL thực để nhập kho.`);
  const specs = po.specs || {};
  const btpLoc = await locOf(client, 'BTP');

  if (task.stage === 'Thổi') {
    if (!btpLoc) throw new Error('Chưa có kho Bán thành phẩm (BTP) để nhập cuộn — vui lòng tạo kho trước.');
    // Sản phẩm đầu ra của dòng Thổi (ô chọn trên màn phân công; mặc định = cuộn cấu hình / SP lệnh nếu lệnh là BTP).
    const outProduct = await resolveBlowOutput(client, po, task);
    await applyStock(client, {
      product_id: outProduct, location_id: btpLoc, delta: q, unit: 'kg',
      specs, lot_code: po.order_code, prod_order_id: po.id, clampZero: false,
      trx_type: 'Nhập', ref_code: po.order_code, note: `Nhập cuộn — Thổi (LSX ${po.order_code})`,
    });
    return q;
  }

  if (task.stage === 'Cắt') {
    const tpLoc = await locOf(client, 'TP');
    if (!tpLoc) throw new Error('Chưa có kho Thành phẩm (TP) để nhập bao bì — vui lòng tạo kho trước.');
    if (!btpLoc) throw new Error('Chưa có kho Bán thành phẩm (BTP) để trừ cuộn — vui lòng tạo kho trước.');
    const rollId = await resolveCutRollProduct(client, po); // cuộn cần trừ = SP đầu ra của dòng Thổi trong lệnh
    const cutOutput = task.output_product_id || po.product_id; // bao bì đầu ra (ô chọn; mặc định = SP lệnh)
    if (upUnit(po.unit) !== 'Kg') throw new Error(`Đơn vị sản phẩm "${po.product_code}" là "${po.unit}" — công đoạn Cắt chỉ hỗ trợ đơn vị kg.`);

    const specKey = buildSpecKey(specs);
    // Các lô cuộn khả dụng ở BTP, khớp 100% thông số; ưu tiên lô của chính lệnh rồi FIFO. Khóa để chống cắt song song.
    const lots = (await client.query(`
      SELECT s.id, s.location_id, s.lot_code, s.quantity, s.specs
      FROM inventory_stock s
      JOIN locations l  ON l.id = s.location_id
      JOIN warehouses w ON w.id = l.warehouse_id
      WHERE s.product_id = $1 AND s.spec_key = $2 AND w.warehouse_type = 'BTP' AND s.quantity > 0
      ORDER BY (s.lot_code = $3) DESC, s.created_at ASC
      FOR UPDATE OF s`, [rollId, specKey, po.order_code])).rows;
    const total = lots.reduce((s, r) => s + Number(r.quantity), 0);
    if (total < q - 1e-6) {
      throw new Error(`Kho BTP chỉ còn ${total} kg cuộn [${specLabel(specs)}]. Không đủ để cắt ${q} kg.`);
    }

    const finishSet = new Set((finishLots || []).map(String));
    let need = q;
    for (const lot of lots) {
      const avail = Number(lot.quantity);
      const take = Math.min(avail, Math.max(need, 0));
      const marked = finishSet.has(lot.lot_code);
      const writeOff = marked ? avail - take : 0; // phần dư xóa do "đã hết cuộn"
      if (take <= 1e-6 && writeOff <= 1e-6) { if (need <= 1e-6) continue; else continue; }
      if (take > 0) {
        await applyStock(client, {
          product_id: rollId, location_id: lot.location_id, delta: -take, unit: 'kg',
          specs: lot.specs || specs, spec_key: specKey, lot_code: lot.lot_code, prod_order_id: po.id,
          clampZero: true, trx_type: 'Xuất', ref_code: po.order_code,
          note: `Trừ cuộn để cắt (LSX ${po.order_code}, lô ${lot.lot_code})`,
        });
      }
      if (writeOff > 1e-6) {
        await applyStock(client, {
          product_id: rollId, location_id: lot.location_id, delta: -writeOff, unit: 'kg',
          specs: lot.specs || specs, spec_key: specKey, lot_code: lot.lot_code, prod_order_id: po.id,
          clampZero: true, trx_type: 'Điều chỉnh', ref_code: po.order_code,
          note: `Hao hụt cắt — ${task.task_code} (lô ${lot.lot_code})`,
        });
      }
      await client.query(
        `INSERT INTO production_roll_usage
           (production_order_id, task_code, roll_product_id, location_id, lot_code, spec_key, specs, qty_used, qty_written_off)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [po.id, task.task_code, rollId, lot.location_id, lot.lot_code, specKey,
         JSON.stringify(lot.specs || specs), take, writeOff]);
      need -= take;
    }

    // Nhập bao bì (sản phẩm đầu ra của dòng Cắt; mặc định = SP của lệnh) vào TP
    await applyStock(client, {
      product_id: cutOutput, location_id: tpLoc, delta: q, unit: 'kg',
      specs, lot_code: po.order_code, prod_order_id: po.id, clampZero: false,
      trx_type: 'Nhập', ref_code: po.order_code, note: `Nhập bao bì — Cắt (LSX ${po.order_code})`,
    });
    return q;
  }

  // Công đoạn khác (nếu có): không ghi kho
  return 0;
}

// Ràng buộc cấu trúc lệnh (§3.3), xét CẢ danh sách loại của SP (1 SP có thể vừa TP vừa BTP):
//  - SP chỉ là Bán thành phẩm (không có loại TP) → không được có Cắt.
//  - SP chỉ là Thành phẩm (không có loại BTP)   → có Thổi thì phải có Cắt (không được chỉ Thổi).
//  - SP vừa TP vừa BTP → cho phép cả "chỉ Thổi" (bán cuộn) lẫn "Thổi + Cắt" (bao bì).
// Mặc định tạo Thổi + Cắt; thừa công đoạn nào người dùng xóa. Trả về thông báo lỗi, hoặc null nếu hợp lệ.
function orderStructureError(productType, stages, productTypes) {
  const types = (Array.isArray(productTypes) && productTypes.length) ? productTypes : (productType ? [productType] : []);
  const isTP = types.includes('Thành phẩm');
  const isBTP = types.includes('Bán thành phẩm');
  const hasCut = stages.includes('Cắt');
  const hasBlow = stages.includes('Thổi');
  if (isBTP && !isTP && hasCut) return 'Sản phẩm này chỉ là Bán thành phẩm (cuộn) — hãy xóa công đoạn Cắt (chỉ cần Thổi).';
  if (!isBTP && hasBlow && !hasCut) return 'Sản phẩm này là Thành phẩm (bao bì) — phải có công đoạn Cắt, không được chỉ có Thổi.';
  return null;
}

/**
 * Tính lại trạng thái lệnh từ các phân công trong DB, đồng bộ đơn hàng,
 * và backflush kho khi hoàn thành lần đầu. Dùng cho cả saveTasks lẫn quét QR.
 */
async function recomputeOrder(client, poId) {
  const ord = (await client.query(`SELECT quantity, sales_order_id, sales_order_item_id, inventory_posted, posted_qty FROM production_orders WHERE id = $1`, [poId])).rows[0];
  if (!ord) return;
  const tks = (await client.query(`SELECT stage, status, quantity, actual_qty FROM production_tasks WHERE production_order_id = $1`, [poId])).rows;
  const finalStage = tks.some(t => t.stage === 'Cắt') ? 'Cắt' : 'Thổi';
  const qtyOf = (t) => (t.actual_qty == null ? Number(t.quantity) : Number(t.actual_qty)) || 0;
  const produced = tks.filter(t => t.stage === finalStage && t.status === 'Hoàn thành').reduce((s, t) => s + qtyOf(t), 0);

  // M22: "Chờ duyệt" (= chưa lên lịch) KHÔNG còn là trạng thái thủ công — trước đây lệnh làm xong vẫn kẹt
  // "Chờ duyệt" (báo cáo tính 0, đơn không lên trạng thái). Chỉ còn "Chờ NVL" / "Đã hủy" là do người dùng đặt.
  const MANUAL_STATUSES = new Set(['Chờ nguyên vật liệu', 'Đã hủy']);
  const cur = (await client.query(`SELECT status FROM production_orders WHERE id = $1`, [poId])).rows[0]?.status;
  // Chỉ lên "Đang sản xuất" khi đã có lần thực sự bắt đầu (lưu phân công toàn lần "Chờ" thì giữ nguyên trạng thái);
  // lệnh đang "Hoàn thành" mà sản lượng giảm dưới SL lệnh thì quay lại "Đang sản xuất".
  const anyStarted = tks.some(t => ['Đang sản xuất', 'Dừng sản xuất', 'Hoàn thành'].includes(t.status));
  const poStatus = !tks.length ? null
    : produced >= Number(ord.quantity) ? 'Hoàn thành'
    : (anyStarted || cur === 'Hoàn thành') ? 'Đang sản xuất'
    : null;
  // Chỉ cập nhật nếu có kết quả tính toán VÀ trạng thái hiện tại không phải do người dùng đặt thủ công
  if (poStatus && !MANUAL_STATUSES.has(cur)) await client.query(`UPDATE production_orders SET status = $1 WHERE id = $2`, [poStatus, poId]);
  // Ghi kho KHÔNG còn làm ở đây: kho ghi theo sự kiện khi dòng hoàn thành (completeTasks → postTaskStock).
  // Chỉ đồng bộ lại posted_qty cấp lệnh (hiển thị/tương thích) = tổng posted_qty các lần công đoạn cuối.
  const pq = (await client.query(
    `SELECT COALESCE(SUM(posted_qty),0) AS s FROM production_tasks WHERE production_order_id = $1 AND stage = $2`,
    [poId, finalStage])).rows[0].s;
  await client.query(`UPDATE production_orders SET posted_qty = $2::numeric, inventory_posted = ($2::numeric > 0) WHERE id = $1`, [poId, pq]);

  // Ghi ngày thực tế lên dòng đơn hàng gắn với lệnh SX này
  if (ord.sales_order_item_id) {
    const started = tks.some(t => ['Đang sản xuất', 'Dừng sản xuất', 'Hoàn thành'].includes(t.status));
    if (started) {
      // Ngày bắt đầu thực tế = lần đầu một công đoạn của dòng được bắt đầu
      await client.query(
        `UPDATE sales_order_items SET actual_start_date = NOW() WHERE id = $1 AND actual_start_date IS NULL`,
        [ord.sales_order_item_id]);
    }
    // Ngày kết thúc thực tế = khi TẤT CẢ lệnh SX của dòng đều đã hoàn thành
    const poAgg = (await client.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'Hoàn thành')::int AS done
       FROM production_orders WHERE sales_order_item_id = $1 AND is_deleted = FALSE`, [ord.sales_order_item_id])).rows[0];
    if (poAgg.total > 0 && poAgg.done === poAgg.total) {
      await client.query(
        `UPDATE sales_order_items SET actual_end_date = NOW() WHERE id = $1 AND actual_end_date IS NULL`,
        [ord.sales_order_item_id]);
    } else {
      // Nếu lại có lệnh chưa xong (ví dụ thêm LSX mới) thì bỏ ngày kết thúc
      await client.query(
        `UPDATE sales_order_items SET actual_end_date = NULL WHERE id = $1`, [ord.sales_order_item_id]);
    }
  }

  if (ord.sales_order_id) {
    const agg = (await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'Hoàn thành')::int AS done,
             COUNT(*) FILTER (WHERE status IN ('Đang sản xuất','Hoàn thành'))::int AS active
      FROM production_orders WHERE sales_order_id = $1 AND is_deleted = FALSE`, [ord.sales_order_id])).rows[0];
    const pending = (await client.query(
      `SELECT COUNT(*)::int AS n FROM sales_order_items WHERE sales_order_id = $1 AND is_planned = FALSE`, [ord.sales_order_id])).rows[0].n;
    let soStatus = null;
    // SX xong toàn bộ → "Hoàn thành sản xuất" (các khâu giao hàng/thanh toán quản lý tiếp sau đó)
    if (agg.total > 0 && agg.done === agg.total && pending === 0) soStatus = 'Hoàn thành sản xuất';
    else if (agg.active > 0) soStatus = 'Đang sản xuất';
    // Không tự đè khi đơn đã sang khâu giao hàng/thanh toán
    if (soStatus) await client.query(
      `UPDATE sales_orders SET status = $1 WHERE id = $2 AND is_deleted = FALSE
         AND status IN ('Mới','Đang sản xuất','Hoàn thành sản xuất')`, [soStatus, ord.sales_order_id]);
  }
  return { produced, status: poStatus };
}

exports.list = async (req, res) => {
  try {
    const where = ['po.is_deleted = FALSE'];
    const params = []; let i = 1;
    const { status, machine_id, customer_id, q, planned_date } = req.query;
    if (status)      { where.push(`po.status = $${i++}`); params.push(status); }
    if (machine_id)  { where.push(`po.machine_id = $${i++}`); params.push(machine_id); }
    if (customer_id) { where.push(`po.customer_id = $${i++}`); params.push(customer_id); }
    if (planned_date){ where.push(`po.planned_date = $${i++}`); params.push(planned_date); }
    if (q)           { where.push(`(po.order_code ILIKE $${i} OR p.product_name ILIKE $${i})`); params.push(`%${q}%`); i++; }
    
    // Áp dụng Data Scope
    const scopeCond = getDataScope(req, 'production', 'view', { factoryCol: 'po.assigned_team' });
    where.push(`(${scopeCond})`);

    const sql = `${SELECT_JOIN} WHERE ${where.join(' AND ')} ORDER BY CASE WHEN po.priority = 'Cao' THEN 1 WHEN po.priority = 'Trung bình' THEN 2 ELSE 3 END, po.created_at DESC`;
    const { rows } = await db.query(sql, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy danh sách lệnh sản xuất' }); }
};

exports.getById = async (req, res) => {
  try {
    const { rows } = await db.query(`${SELECT_JOIN} WHERE po.id = $1 AND po.is_deleted = FALSE`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
    // Sản phẩm cuộn mặc định (điền sẵn ô "Sản phẩm đầu ra" dòng Thổi trên frontend)
    const drp = await getRollProductId(db);
    res.json({ ...rows[0], default_roll_product_id: drp });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết' }); }
};

exports.create = async (req, res) => {
  try {
    const b = req.body;
    if (!b.product_id || !b.quantity) return res.status(400).json({ message: 'Thiếu Sản phẩm hoặc Số lượng' });
    const finishing = Array.isArray(b.finishing)
      ? b.finishing.filter(f => f && f.name).map(f => ({ name: f.name, checked: !!f.checked }))
      : [];
    const specs = specsFromBody(b);
    const a = legacyAttrs(specs);
    const group_key = [b.product_id, buildSpecKey(specs)].join('||');
    let priority = b.priority || 'Trung bình';
    if (!b.priority && b.sales_order_id) {
       const so = (await db.query(`SELECT priority FROM sales_orders WHERE id = $1`, [b.sales_order_id])).rows[0];
       if (so && so.priority) priority = so.priority;
    }

    const { rows } = await db.query(
      `INSERT INTO production_orders
         (sales_order_id, customer_id, product_id, quantity, unit,
          specs, spec_key, attr_size, attr_thickness, attr_color, finishing,
          machine_id, planned_date, shift, assigned_team, group_key, due_date, status, note, assigned_worker, priority, mix_ratio, material_type)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        b.sales_order_id || null, b.customer_id || null, b.product_id, b.quantity, upUnit(b.unit),
        JSON.stringify(specs), buildSpecKey(specs), a.size || null, a.thickness || null, a.color || null, JSON.stringify(finishing),
        b.machine_id || null, b.planned_date || null, b.shift || null, b.assigned_team || null,
        group_key, b.due_date || null, b.status || 'Chờ duyệt', b.note || null, b.assigned_worker || null, priority,
        JSON.stringify(b.mix_ratio || []), b.material_type || null
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi tạo lệnh sản xuất' }); }
};

exports.update = async (req, res) => {
  try {
    const b = req.body;
    // Không cho sửa NỘI DUNG lệnh đã Hoàn thành/Đã hủy, TRỪ KHI lệnh Hoàn thành mà
    // có công đoạn chưa gán máy/ca/đội/công nhân/thực tế (cần bổ sung).
    const contentKeys = Object.keys(b).filter((k) => k !== 'status');
    let restrictToAssignment = false; // lệnh Hoàn thành: chỉ cho bổ sung máy/ca/đội/công nhân/ghi chú
    if (contentKeys.length) {
      const cur = (await db.query(`SELECT status, product_id, customer_id, quantity, unit, spec_key, specs, sales_order_item_id FROM production_orders WHERE id = $1 AND is_deleted = FALSE`, [req.params.id])).rows[0];
      if (cur && cur.status === 'Đã hủy') {
        return res.status(400).json({ message: `Lệnh đã Hủy — không thể sửa.` });
      }
      // LSX tạo từ dòng đơn hàng: Sản phẩm / Khách hàng / SL cần SX / Đơn vị KẾ THỪA từ đơn, không sửa ở LSX
      // (sửa ở đây sẽ lệch ngược với đơn: planned_qty của dòng đơn tính theo Σ SL các LSX).
      // Chỉ chặn khi giá trị THỰC SỰ đổi — form vẫn gửi lại đủ trường mỗi lần lưu.
      if (cur && cur.sales_order_item_id) {
        const s = (v) => (v == null ? '' : String(v));
        const changed = [];
        if (b.product_id !== undefined && s(b.product_id) !== s(cur.product_id)) changed.push('sản phẩm');
        if (b.customer_id !== undefined && s(b.customer_id) !== s(cur.customer_id)) changed.push('khách hàng');
        if (b.quantity !== undefined && Number(b.quantity) !== Number(cur.quantity)) changed.push('số lượng cần sản xuất');
        if (b.unit !== undefined && s(b.unit && upUnit(b.unit)) !== s(cur.unit && upUnit(cur.unit))) changed.push('đơn vị');
        if (changed.length) {
          return res.status(400).json({ message: `Lệnh tạo từ đơn hàng — ${changed.join(', ')} kế thừa từ đơn, không sửa ở lệnh sản xuất. Hãy sửa ở đơn hàng (hoặc hủy lệnh rồi lên kế hoạch lại).` });
        }
      }
      if (cur && cur.status === 'Hoàn thành') {
        // Kiểm tra xem có công đoạn chưa đủ thông tin không
        const { rows: incompleteTasks } = await db.query(
          `SELECT id FROM production_tasks
           WHERE production_order_id = $1
             AND (machine_id IS NULL OR shift IS NULL OR shift = ''
                  OR assigned_team IS NULL OR assigned_team = ''
                  OR assigned_worker IS NULL OR assigned_worker = ''
                  OR actual_qty IS NULL)`,
          [req.params.id]
        );
        if (!incompleteTasks.length) {
          return res.status(400).json({ message: `Lệnh đã Hoàn thành và tất cả công đoạn đã đầy đủ thông tin — không thể sửa.` });
        }
        // Lệnh ĐÃ nhập kho: KHÔNG cho đổi sản phẩm / số lượng (sẽ lệch tồn),
        // chỉ cho bổ sung máy/ca/đội/công nhân/ghi chú.
        if ((b.product_id !== undefined && b.product_id !== cur.product_id) ||
            (b.quantity !== undefined && Number(b.quantity) !== Number(cur.quantity))) {
          return res.status(400).json({ message: 'Lệnh đã Hoàn thành (đã nhập kho) — chỉ được bổ sung máy/ca/đội/công nhân/ghi chú, KHÔNG được đổi sản phẩm hoặc số lượng.' });
        }
        restrictToAssignment = true;
      }
      // L57: lệnh (chưa Hoàn thành) đã có sản lượng nhập kho → KHÔNG đổi sản phẩm / đơn vị / thông số.
      // syncOrderInventory nhập kho theo product_id + specs HIỆN TẠI của lệnh và chỉ nhớ posted_qty:
      // đổi giữa chừng thì phần đã nhập nằm ở SP cũ, còn mọi điều chỉnh sau đó cộng/trừ vào SP mới → lệch kho.
      // Chỉ chặn khi giá trị THỰC SỰ đổi (form gửi lại đủ trường mỗi lần lưu). Đổi SL vẫn được.
      if (cur && !restrictToAssignment && await hasPostedStock(db, req.params.id)) {
        const changed = [];
        if (b.product_id !== undefined && b.product_id !== cur.product_id) changed.push('sản phẩm');
        if (b.unit !== undefined && cur.unit != null && upUnit(b.unit) !== upUnit(cur.unit)) changed.push('đơn vị');
        const specKeys = ['specs', 'attr_size', 'attr_thickness', 'attr_color'];
        if (specKeys.some((k) => b[k] !== undefined)) {
          const curKey = cur.spec_key != null ? cur.spec_key : buildSpecKey(cur.specs || {});
          if (buildSpecKey(specsFromBody(b)) !== curKey) changed.push('thông số');
        }
        if (changed.length) {
          return res.status(400).json({ message: `Lệnh đã có sản lượng nhập kho — không đổi được ${changed.join(', ')}. Hãy đưa SL thực các lần về 0 (kho tự trừ lại) rồi mới đổi, hoặc tạo lệnh mới.` });
        }
      }
    }
    // M04: chuyển trạng thái theo bảng PO_TRANSITIONS — áp cả khi body CHỈ có `status`
    // (trước đây khối kiểm ở trên bỏ qua `status` → mở lại được lệnh "Đã hủy", đưa lệnh đã nhập kho về
    // "Chờ duyệt" rồi xoá). Lệnh đã có sản lượng nhập kho không lùi về trạng thái "chưa sản xuất" / huỷ.
    if (b.status !== undefined) {
      const cur = (await db.query(`SELECT status FROM production_orders WHERE id = $1 AND is_deleted = FALSE`, [req.params.id])).rows[0];
      if (!cur) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
      if (b.status !== cur.status) {
        if (!(PO_TRANSITIONS[cur.status] || []).includes(b.status)) {
          return res.status(400).json({ message: `Không thể chuyển trạng thái lệnh "${cur.status}" → "${b.status}".` });
        }
        if (PO_NO_STOCK_STATUSES.has(b.status) && await hasPostedStock(db, req.params.id)) {
          return res.status(400).json({ message: `Lệnh đã có sản lượng nhập kho — không chuyển về "${b.status}" được. Hãy đưa SL thực các lần về 0 (kho tự trừ lại) trước.` });
        }
      }
    }
    // Kho nay ghi theo SỰ KIỆN (khi từng dòng phân công hoàn thành — completeTasks). Nếu cho đặt tay
    // lệnh sang 'Hoàn thành' qua đây, lệnh sẽ mang trạng thái Hoàn thành mà KHÔNG ghi kho (tồn thiếu).
    // Trạng thái 'Hoàn thành' cấp lệnh chỉ được suy ra tự động từ các dòng đã hoàn thành (recomputeOrder).
    if (b.status === 'Hoàn thành') {
      return res.status(400).json({ message: 'Không đặt tay trạng thái lệnh sang "Hoàn thành". Hãy hoàn thành từng dòng phân công ở màn chi tiết lệnh (nút "Hoàn thành"); lệnh sẽ tự chuyển Hoàn thành khi đủ sản lượng.' });
    }
    // Khi lệnh đã Hoàn thành: CHỈ cho phép các trường bổ sung bên dưới (không đụng SP/SL/thông số).
    const ASSIGNMENT_ONLY = new Set(['machine_id', 'shift', 'assigned_team', 'assigned_worker', 'planned_date', 'note', 'status']);
    const fields = ['sales_order_id','customer_id','product_id','quantity','unit',
      'machine_id','planned_date','shift','assigned_team','assigned_worker','due_date','status','note','priority','mix_ratio','material_type'];
    const cols = [], vals = []; let i = 1;
    for (const f of fields) {
      if (b[f] === undefined) continue;
      if (restrictToAssignment && !ASSIGNMENT_ONLY.has(f)) continue; // lệnh Hoàn thành: bỏ qua field không được phép sửa
      cols.push(`${f} = $${i++}`); vals.push(f === 'unit' ? upUnit(b[f]) : (b[f] === '' ? null : (f === 'mix_ratio' ? JSON.stringify(b[f]) : b[f])));
    }
    if (b.finishing !== undefined && !restrictToAssignment) {
      const finishing = Array.isArray(b.finishing) ? b.finishing.filter(f => f && f.name).map(f => ({ name: f.name, checked: !!f.checked })) : [];
      cols.push(`finishing = $${i++}::jsonb`); vals.push(JSON.stringify(finishing));
    }
    if (!restrictToAssignment && (b.specs !== undefined || b.attr_size !== undefined || b.attr_thickness !== undefined || b.attr_color !== undefined)) {
      const specs = specsFromBody(b);
      const a = legacyAttrs(specs);
      cols.push(`specs = $${i++}::jsonb`); vals.push(JSON.stringify(specs));
      cols.push(`spec_key = $${i++}`); vals.push(buildSpecKey(specs));
      cols.push(`attr_size = $${i++}`); vals.push(a.size || null);
      cols.push(`attr_thickness = $${i++}`); vals.push(a.thickness || null);
      cols.push(`attr_color = $${i++}`); vals.push(a.color || null);
      cols.push(`group_key = $${i++}`); vals.push([b.product_id || '', buildSpecKey(specs)].join('||'));
    }
    if (!cols.length) return res.status(400).json({ message: 'Không có trường để cập nhật' });
    const { rows } = await db.query(
      `UPDATE production_orders SET ${cols.join(', ')} WHERE id = $${i} AND is_deleted = FALSE RETURNING *`,
      [...vals, req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
    // Hủy lệnh hoặc đổi SL → tính lại planned_qty của dòng đơn gắn với lệnh
    await recomputePlannedQty(db, rows[0].sales_order_item_id);
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi cập nhật' }); }
};

// Lập lịch / phân bổ nguồn lực
exports.schedule = async (req, res) => {
  try {
    const { machine_id, planned_date, shift, assigned_team, assigned_worker } = req.body;
    const { rows } = await db.query(
      `UPDATE production_orders
         SET machine_id=$1, planned_date=$2, shift=$3, assigned_team=$4, assigned_worker=$5,
             status = CASE WHEN status='Chờ duyệt' THEN 'Đã lên kế hoạch' ELSE status END
       WHERE id=$6 AND is_deleted=FALSE RETURNING *`,
      [machine_id || null, planned_date || null, shift || null, assigned_team || null, assigned_worker || null, req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lập lịch' }); }
};

// PUT /api/production-orders/:id/reschedule — kéo-thả lịch: dời CẢ lệnh + phân công (giữ khoảng cách giữa các bước)
exports.reschedule = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const id = req.params.id;
    const date = req.body.date || null; // 'YYYY-MM-DD' hoặc rỗng = bỏ lịch
    await client.query('BEGIN');
    const hdr = (await client.query(`SELECT planned_date, status FROM production_orders WHERE id=$1 AND is_deleted=FALSE`, [id])).rows[0];
    if (!hdr) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy lệnh' }); }
    const tasks = (await client.query(`SELECT id, planned_date, planned_end_date FROM production_tasks WHERE production_order_id=$1`, [id])).rows;
    let oldStart = null;
    tasks.forEach((t) => { if (t.planned_date && (!oldStart || t.planned_date < oldStart)) oldStart = t.planned_date; });
    if (!oldStart) oldStart = hdr.planned_date;

    if (!date) {
      await client.query(`UPDATE production_orders SET planned_date = NULL WHERE id=$1`, [id]);
      await client.query(`UPDATE production_tasks SET planned_date = NULL, planned_end_date = NULL WHERE production_order_id=$1`, [id]);
    } else {
      const dayMs = 86400000;
      const toDate = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00');
      const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const delta = oldStart ? Math.round((toDate(date) - toDate(oldStart)) / dayMs) : 0;
      const shift = (val) => (val ? ymd(new Date(toDate(val).getTime() + delta * dayMs)) : null);
      await client.query(
        `UPDATE production_orders SET planned_date=$1, status = CASE WHEN status='Chờ duyệt' THEN 'Đã lên kế hoạch' ELSE status END WHERE id=$2`,
        [date, id]);
      for (const t of tasks) {
        const np = t.planned_date ? shift(t.planned_date) : date;
        const ne = t.planned_end_date ? shift(t.planned_end_date) : null;
        await client.query(`UPDATE production_tasks SET planned_date=$1, planned_end_date=$2 WHERE id=$3`, [np, ne, t.id]);
      }
    }
    await client.query('COMMIT');
    res.json({ message: 'Đã xếp lịch' });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi xếp lịch' }); }
  finally { client.release(); }
};

// Tính lại planned_qty của 1 dòng đơn = Σ SL các lệnh SX CHƯA hủy/chưa xóa gắn với dòng đó.
// Gọi khi hủy / xóa / sửa lệnh → dòng đơn hiện đúng "còn phải lên kế hoạch" (trước đây chỉ cộng, không trừ).
async function recomputePlannedQty(conn, soItemId) {
  if (!soItemId) return;
  await conn.query(`
    UPDATE sales_order_items it SET
      planned_qty = sub.s,
      is_planned  = (sub.s >= it.quantity)
    FROM (
      SELECT COALESCE(SUM(po.quantity), 0) AS s
      FROM production_orders po
      WHERE po.sales_order_item_id = $1 AND po.is_deleted = FALSE AND po.status <> 'Đã hủy'
    ) sub
    WHERE it.id = $1`, [soItemId]);
}

exports.remove = async (req, res) => {
  try {
    // M04: lệnh đã có sản lượng nhập kho thì không xoá (dù đang ở trạng thái nào) — tồn đã nhập sẽ mồ côi.
    if (await hasPostedStock(db, req.params.id)) {
      return res.status(400).json({ message: 'Lệnh đã có sản lượng nhập kho — không xoá được. Hãy đưa SL thực các lần về 0 (kho tự trừ lại) trước.' });
    }
    const g = await guardDelete('production_orders', req.params.id, {
      allow: ['Đã hủy', 'Chờ duyệt'],
      message: 'Không thể xóa lệnh đang sản xuất / đã lên kế hoạch / đã hoàn thành. Chỉ xóa được lệnh ở trạng thái "Đã hủy" (hoặc "Chờ duyệt" chưa lên lịch). Vui lòng hủy lệnh trước.',
    });
    if (g.notFound) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
    if (g.blocked) return res.status(400).json({ message: g.message });

    const soItemId = (await db.query(`SELECT sales_order_item_id FROM production_orders WHERE id = $1`, [req.params.id])).rows[0]?.sales_order_item_id;
    const { rowCount } = await db.query(
      `UPDATE production_orders SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
    await recomputePlannedQty(db, soItemId); // trừ lại planned_qty của dòng đơn
    res.json({ message: 'Đã xóa lệnh sản xuất' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa' }); }
};

/* ===== Phân công sản xuất (chia lệnh nhỏ theo công đoạn + sản lượng) ===== */

// GET /api/production/gantt?from=&to=  — dữ liệu vẽ biểu đồ Gantt phân công
exports.gantt = async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = ['t.planned_date IS NOT NULL'];
    const params = []; let i = 1;
    if (to) { where.push(`t.planned_date <= $${i++}`); params.push(to); }
    if (from) { where.push(`COALESCE(t.planned_end_date, t.planned_date) >= $${i++}`); params.push(from); }
    const { rows } = await db.query(`
      SELECT t.id, t.task_code, t.stage, t.quantity, t.status, t.shift, t.assigned_team,
             t.planned_date AS start_date, COALESCE(t.planned_end_date, t.planned_date) AS end_date,
             t.machine_id, m.name AS machine_name, m.factory AS machine_factory,
             po.id AS production_order_id, po.order_code, po.attr_color, po.attr_size, p.product_name
      FROM production_tasks t
      LEFT JOIN machines m ON m.id = t.machine_id
      JOIN production_orders po ON po.id = t.production_order_id
      JOIN products p ON p.id = po.product_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.factory NULLS LAST, m.name NULLS LAST, t.planned_date`, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy dữ liệu Gantt' }); }
};

// GET /api/production-orders/:id/tasks
exports.getTasks = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT t.*, m.name AS machine_name, m.factory AS machine_factory
      FROM production_tasks t LEFT JOIN machines m ON m.id = t.machine_id
      WHERE t.production_order_id = $1 ORDER BY t.seq`, [req.params.id]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy phân công' }); }
};

// GET /api/production/execution — danh sách công việc cho công nhân/đội thực thi
exports.executionTasks = async (req, res) => {
  try {
    // M05: không liệt kê lô của lệnh đã Hủy ở màn Thực thi (cập nhật lô của lệnh hủy cũng bị chặn ở updateTask)
    const where = ['po.is_deleted = FALSE', `po.status <> 'Đã hủy'`]; const params = []; let i = 1;
    const { team, worker, status, q } = req.query;
    if (team)   { where.push(`t.assigned_team = $${i++}`); params.push(team); }
    if (worker) { where.push(`t.assigned_worker = $${i++}`); params.push(worker); }
    if (status) { where.push(`t.status = $${i++}`); params.push(status); }
    if (q)      { where.push(`(po.order_code ILIKE $${i} OR p.product_name ILIKE $${i} OR p.product_code ILIKE $${i})`); params.push(`%${q}%`); i++; }
    const { rows } = await db.query(`
      SELECT t.id, t.task_code, t.stage, t.quantity, t.actual_qty, t.scrap_qty, t.status, t.shift,
             t.planned_date, t.planned_end_date, t.assigned_team, t.assigned_worker,
             m.name AS machine_name,
             po.id AS production_order_id, po.order_code, po.due_date, po.unit,
             po.attr_color, po.attr_size, po.attr_thickness, po.specs, po.priority,
             p.product_code, p.product_name,
             c.name AS customer_name, c.phone AS customer_phone,
             so.order_code AS sales_order_code, po.note AS order_note,
             COALESCE(po.material_type, so.material_type) AS material_type,
             so.note AS sales_order_note,
             COALESCE(po.mix_ratio, so.mix_ratio) AS mix_ratio
      FROM production_tasks t
      JOIN production_orders po ON po.id = t.production_order_id
      JOIN products p ON p.id = po.product_id
      LEFT JOIN machines m ON m.id = t.machine_id
      LEFT JOIN customers c ON c.id = po.customer_id
      LEFT JOIN sales_orders so ON so.id = po.sales_order_id
      WHERE ${where.join(' AND ')}
      ORDER BY (t.status IN ('Hoàn thành','Đã hủy')) ASC, CASE WHEN po.priority = 'Cao' THEN 1 WHEN po.priority = 'Trung bình' THEN 2 ELSE 3 END, po.due_date NULLS LAST, t.planned_date NULLS LAST`, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy công việc sản xuất' }); }
};

// GET /api/production/task-by-code/:code — tra lô theo mã (cho quét QR)
exports.getTaskByCode = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT t.*, m.name AS machine_name,
             po.order_code, po.quantity AS order_quantity, po.attr_color, po.attr_size, po.attr_thickness, po.unit,
             p.product_name, c.name AS customer_name, so.order_code AS sales_order_code
      FROM production_tasks t
      JOIN production_orders po ON po.id = t.production_order_id
      JOIN products p ON p.id = po.product_id
      LEFT JOIN machines m ON m.id = t.machine_id
      LEFT JOIN customers c ON c.id = po.customer_id
      LEFT JOIN sales_orders so ON so.id = po.sales_order_id
      WHERE t.task_code = $1 LIMIT 1`, [req.params.code]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy lô: ' + req.params.code });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi tra lô' }); }
};

// GET /api/production-orders/:id/materials — NVL gợi ý từ BOM (theo SL lệnh) + đã ghi nhận
exports.getMaterials = async (req, res) => {
  try {
    const poId = req.params.id;
    const po = (await db.query(
      `SELECT po.id, po.product_id, po.quantity, p.product_name, p.product_code
       FROM production_orders po JOIN products p ON p.id = po.product_id WHERE po.id = $1`, [poId])).rows[0];
    if (!po) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });

    const bom = (await db.query(
      `SELECT id, output_quantity FROM boms WHERE product_id = $1 AND is_deleted = FALSE AND status = 'Hoạt động' ORDER BY created_at DESC LIMIT 1`,
      [po.product_id])).rows[0];

    const usage = Object.fromEntries((await db.query(
      `SELECT material_id, qty FROM production_material_usage WHERE production_order_id = $1`, [poId])).rows.map((r) => [r.material_id, Number(r.qty)]));

    let lines = [];
    if (bom) {
      const factor = Number(po.quantity) / (Number(bom.output_quantity) || 1);
      const bl = (await db.query(
        `SELECT bl.material_id, bl.quantity, bl.unit, p.product_code, p.product_name
         FROM bom_lines bl JOIN products p ON p.id = bl.material_id WHERE bl.bom_id = $1 ORDER BY bl.line_no`, [bom.id])).rows;
      lines = await Promise.all(bl.map(async (l) => {
        const oh = (await db.query(`SELECT COALESCE(SUM(quantity),0)::numeric AS q FROM inventory_stock WHERE product_id = $1`, [l.material_id])).rows[0].q;
        const suggested = Number(l.quantity) * factor;
        const recorded = Object.prototype.hasOwnProperty.call(usage, l.material_id);
        return {
          material_id: l.material_id, material_code: l.product_code, material_name: l.product_name,
          unit: l.unit, suggested_qty: suggested, used_qty: recorded ? usage[l.material_id] : suggested,
          on_hand: Number(oh), recorded,
        };
      }));
    }
    res.json({ product: po, has_bom: !!bom, has_usage: Object.keys(usage).length > 0, lines });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy NVL theo BOM' }); }
};

// POST /api/production-orders/:id/materials — CHỈ GHI NHẬN NVL thực tế (theo dõi tiêu hao).
// KHÔNG trừ kho nữa: việc trừ kho NVL đã chuyển sang "Yêu cầu nguyên vật liệu" (xuất kho) ở màn Lệnh SX,
// tránh trừ trùng 2 lần. Phần này chỉ để so sánh kế hoạch (cần cung cấp) vs thực tế dùng.
exports.saveMaterials = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const poId = req.params.id;
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    const po = (await client.query(`SELECT id FROM production_orders WHERE id = $1`, [poId])).rows[0];
    if (!po) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });

    await client.query('BEGIN');
    const seen = new Set();
    for (const l of lines) {
      if (!l.material_id) continue;
      seen.add(l.material_id);
      await client.query(
        `INSERT INTO production_material_usage (production_order_id, material_id, qty, unit)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (production_order_id, material_id)
         DO UPDATE SET qty = EXCLUDED.qty, unit = EXCLUDED.unit, updated_at = now()`,
        [poId, l.material_id, Number(l.qty) || 0, upUnit(l.unit)]);
    }
    const existing = (await client.query(`SELECT material_id FROM production_material_usage WHERE production_order_id = $1`, [poId])).rows.map((r) => r.material_id);
    for (const mid of existing) if (!seen.has(mid)) await client.query(`DELETE FROM production_material_usage WHERE production_order_id = $1 AND material_id = $2`, [poId, mid]);
    await client.query('COMMIT');
    res.json({ message: 'Đã ghi nhận NVL thực tế (theo dõi tiêu hao)' });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi ghi nhận NVL' }); }
  finally { client.release(); }
};

// ── NVL CẦN CUNG CẤP (kế hoạch cấp NVL cho lệnh) + Yêu cầu NVL (xuất kho) ──────
// GET /api/production-orders/:id/planned-materials — danh sách NVL cần cung cấp + tồn kho hiện tại
exports.getPlannedMaterials = async (req, res) => {
  try {
    const poId = req.params.id;
    const po = (await db.query(`SELECT materials_issued FROM production_orders WHERE id = $1`, [poId])).rows[0];
    if (!po) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
    const { rows } = await db.query(`
      SELECT pm.material_id, pm.qty, pm.unit, pm.note,
             p.product_code AS material_code, p.product_name AS material_name,
             COALESCE((SELECT SUM(quantity) FROM inventory_stock s WHERE s.product_id = pm.material_id), 0) AS on_hand
      FROM production_order_materials pm
      JOIN products p ON p.id = pm.material_id
      WHERE pm.production_order_id = $1
      ORDER BY pm.created_at`, [poId]);
    // Phiếu xuất kho mới nhất (chưa hủy) của lệnh → để hiển thị trạng thái Chờ xuất / Đã xuất
    const slip = (await db.query(
      `SELECT id, slip_code, status FROM outbound_slips
       WHERE prod_order_id = $1 AND status <> 'Đã hủy' ORDER BY created_at DESC LIMIT 1`, [poId])).rows[0] || null;
    res.json({ data: { materials_issued: po.materials_issued, slip, lines: rows } });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy NVL cần cung cấp' }); }
};

// POST /api/production-orders/:id/planned-materials — lưu danh sách NVL cần cung cấp (thay thế)
exports.savePlannedMaterials = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const poId = req.params.id;
    const lines = (Array.isArray(req.body.lines) ? req.body.lines : []).filter((l) => l && l.material_id);
    const po = (await client.query(`SELECT materials_issued FROM production_orders WHERE id = $1`, [poId])).rows[0];
    if (!po) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
    if (po.materials_issued) return res.status(400).json({ message: 'NVL đã được yêu cầu (xuất kho) — không sửa được danh sách cần cung cấp nữa.' });
    await client.query('BEGIN');
    await client.query(`DELETE FROM production_order_materials WHERE production_order_id = $1`, [poId]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO production_order_materials (production_order_id, material_id, qty, unit, note)
         VALUES ($1,$2,$3,$4,$5)`,
        [poId, l.material_id, Number(l.qty) || 0, upUnit(l.unit), l.note || null]);
    }
    await client.query('COMMIT');
    res.json({ message: 'Đã lưu NVL cần cung cấp', count: lines.length });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi lưu NVL cần cung cấp' }); }
  finally { client.release(); }
};

// POST /api/production-orders/:id/request-materials — YÊU CẦU NVL: tạo PHIẾU XUẤT KHO "Đã xuất" (trừ kho trực tiếp)
exports.requestMaterials = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const poId = req.params.id;
    const po = (await client.query(`SELECT order_code, materials_issued FROM production_orders WHERE id = $1`, [poId])).rows[0];
    if (!po) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
    if (po.materials_issued) return res.status(400).json({ message: 'Lệnh này đã xuất NVL rồi.' });

    await client.query('BEGIN');
    // Lưu danh sách gửi kèm (nếu có) trước khi tạo phiếu
    if (Array.isArray(req.body.lines)) {
      const lines = req.body.lines.filter((l) => l && l.material_id);
      await client.query(`DELETE FROM production_order_materials WHERE production_order_id = $1`, [poId]);
      for (const l of lines) await client.query(
        `INSERT INTO production_order_materials (production_order_id, material_id, qty, unit, note) VALUES ($1,$2,$3,$4,$5)`,
        [poId, l.material_id, Number(l.qty) || 0, upUnit(l.unit), l.note || null]);
    }

    const plan = (await client.query(
      `SELECT material_id, qty, unit, note FROM production_order_materials WHERE production_order_id = $1 AND qty > 0`, [poId])).rows;
    if (!plan.length) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Chưa có NVL cần cung cấp để yêu cầu. Hãy thêm NVL trước.' }); }

    const nvlLoc = (await client.query(
      `SELECT l.id FROM locations l JOIN warehouses w ON w.id = l.warehouse_id
       WHERE w.warehouse_type = 'NVL' AND l.is_deleted = FALSE ORDER BY l.created_at LIMIT 1`)).rows[0]?.id || null;
    if (!nvlLoc) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Hệ thống chưa có Kho Nguyên vật liệu.' }); }

    // Sinh mã phiếu PXK00001…
    const slipCode = (await client.query(
      `SELECT 'PXK' || LPAD((COALESCE(MAX(NULLIF(regexp_replace(slip_code,'\\D','','g'),''))::int,0)+1)::text,5,'0') AS code
       FROM outbound_slips WHERE slip_code ~ '^PXK[0-9]+$'`)).rows[0].code;

    // 2 BƯỚC: tạo phiếu "CHỜ XUẤT" — CHƯA trừ kho. App Kho xác nhận (confirmOutboundSlip)
    // mới kiểm đủ tồn + trừ NVL; thiếu thì chặn, không cho xuất.
    const slip = (await client.query(
      `INSERT INTO outbound_slips (slip_code, purpose, location_id, prod_order_id, status, note, created_by)
       VALUES ($1,'Xuất cho sản xuất',$2,$3,'Chờ xuất',$4,$5) RETURNING id, slip_code`,
      [slipCode, nvlLoc, poId, `Xuất NVL cho lệnh ${po.order_code}`, req.userId || null])).rows[0];

    // Ghi dòng phiếu theo SL YÊU CẦU (lúc xác nhận sẽ FIFO + trừ kho)
    for (const l of plan) await client.query(
      `INSERT INTO outbound_slip_lines (slip_id, product_id, quantity, unit, lot_code, note) VALUES ($1,$2,$3,$4,'',$5)`,
      [slip.id, l.material_id, Number(l.qty), upUnit(l.unit), l.note || null]);

    // Khóa danh sách NVL của lệnh (đã gửi yêu cầu). Hủy phiếu sẽ mở khóa lại.
    await client.query(`UPDATE production_orders SET materials_issued = TRUE WHERE id = $1`, [poId]);
    await client.query('COMMIT');
    res.json({ message: `Đã tạo phiếu xuất kho ${slip.slip_code} (Chờ xuất). Vào Kho → Xuất kho để xác nhận trừ tồn.`, slip_code: slip.slip_code, slip_id: slip.id, count: plan.length });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi yêu cầu NVL' }); }
  finally { client.release(); }
};

// PUT /api/production/tasks/:taskId — cập nhật 1 lô (trạng thái/sản lượng thực/phế) + tính lại lệnh
exports.updateTask = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    const taskId = req.params.taskId;
    const badQty = invalidTaskQty(b);
    if (badQty) return res.status(400).json({ message: badQty });
    // 8c: CHỈ màn chi tiết lệnh (completeTasks/saveTasks) mới ghi SL thực & hoàn thành.
    // Đường này chỉ cho đổi trạng thái vận hành (Đang sản xuất / Dừng sản xuất / Chờ).
    if (b.status === 'Hoàn thành') {
      return res.status(400).json({ message: 'Hãy hoàn thành dòng phân công ở màn chi tiết lệnh (nút "Hoàn thành"), không qua màn này.' });
    }
    if (b.actual_qty !== undefined) {
      return res.status(400).json({ message: 'SL thực chỉ được ghi ở màn chi tiết lệnh.' });
    }
    const cols = [], vals = []; let i = 1;
    const add = (c, v) => { cols.push(`${c} = $${i++}`); vals.push(v); };
    if (b.status !== undefined) add('status', b.status);
    if (b.scrap_qty !== undefined) add('scrap_qty', b.scrap_qty || 0);
    if (!cols.length) return res.status(400).json({ message: 'Không có trường để cập nhật' });
    await client.query('BEGIN');
    // Khoá dòng lệnh để không chạy song song với sửa lệnh / lưu phân công.
    const own = (await client.query(
      `SELECT po.status AS po_status, t.status AS task_status
       FROM production_tasks t JOIN production_orders po ON po.id = t.production_order_id
       WHERE t.id = $1 AND po.is_deleted = FALSE FOR UPDATE OF po`, [taskId])).rows[0];
    if (!own) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy lô' }); }
    if (own.po_status === 'Đã hủy') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Lệnh sản xuất đã Hủy — không cập nhật lô được.' });
    }
    // Dòng ĐÃ Hoàn thành thì bất biến (khóa toàn bộ) — không đổi trạng thái qua đường này.
    if (own.task_status === 'Hoàn thành') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Dòng đã Hoàn thành — đã khóa. Admin có thể "Hủy hoàn thành" ở màn chi tiết lệnh nếu cần sửa.' });
    }
    const r = await client.query(`UPDATE production_tasks SET ${cols.join(', ')} WHERE id = $${i} RETURNING production_order_id`, [...vals, req.params.taskId]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy lô' }); }
    const result = await recomputeOrder(client, r.rows[0].production_order_id);
    await client.query('COMMIT');
    res.json({ message: 'Đã cập nhật lô', ...result });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || err.message || 'Lỗi khi cập nhật lô' }); }
  finally { client.release(); }
};

// PUT /api/production-orders/:id/tasks — lưu toàn bộ phân công (thay thế)
exports.saveTasks = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const poId = req.params.id;
    // M40: khoá lệnh (FOR UPDATE) ngay đầu transaction → 2 lần bấm "Lưu" cùng lúc chạy LẦN LƯỢT.
    // Trước đây đọc không khoá: cả hai cùng thấy posted_qty = 0 → nhập kho 2 lần (TP 2000 thay vì 1000)
    // và DELETE+INSERT chồng nhau → nhân đôi các lần phân công.
    await client.query('BEGIN');
    const bail = async (code, message) => { await client.query('ROLLBACK'); return res.status(code).json({ message }); };
    const po = (await client.query(
      `SELECT po.order_code, po.quantity, po.status, p.product_type, p.product_types
       FROM production_orders po JOIN products p ON p.id = po.product_id
       WHERE po.id = $1 AND po.is_deleted = FALSE FOR UPDATE OF po`, [poId])).rows[0];
    if (!po) return bail(404, 'Không tìm thấy lệnh sản xuất');
    if (po.status === 'Đã hủy') return bail(400, `Lệnh đã Hủy — không thể sửa phân công.`);
    const tasks = Array.isArray(req.body.tasks) ? req.body.tasks.filter(t => t && t.stage) : [];
    for (const [idx, t] of tasks.entries()) {
      const badQty = invalidTaskQty(t, `Lần ${idx + 1} (${t.stage}): `);
      if (badQty) return bail(400, badQty);
    }

    // §3.4: DÒNG ĐÃ HOÀN THÀNH LÀ BẤT BIẾN. Lấy bản ghi cũ đầy đủ để giữ nguyên các dòng đã hoàn thành.
    // Kiểm tra BẤT BIẾN trước ràng buộc cấu trúc/150% để thông báo đúng việc "không xóa dòng đã hoàn thành".
    const prevRows = (await client.query(
      `SELECT task_code, stage, quantity, actual_qty, scrap_qty, machine_id, shift, planned_date,
              planned_end_date, assigned_team, assigned_worker, status, seq, note, assigned_worker_id, posted_qty, output_product_id
       FROM production_tasks WHERE production_order_id = $1`, [poId])).rows;
    const doneByCode = new Map(prevRows.filter(r => r.status === 'Hoàn thành').map(r => [r.task_code, r]));
    let maxSuffix = 0;
    for (const r of prevRows) { const m = /-(\d+)$/.exec(r.task_code || ''); if (m) maxSuffix = Math.max(maxSuffix, Number(m[1])); }

    const incomingCodes = new Set(tasks.filter((t) => t.task_code).map((t) => t.task_code));
    // Dòng đã hoàn thành không được xóa (phải còn trong payload).
    const removedDone = [...doneByCode.keys()].filter((code) => !incomingCodes.has(code));
    if (removedDone.length) {
      return bail(400, `Không thể xóa dòng đã Hoàn thành (đã khóa): ${removedDone.join(', ')}. Nhờ Admin "Hủy hoàn thành" trước nếu cần.`);
    }
    // Dòng mới không được tự đặt trạng thái "Hoàn thành" qua lưu phân công (phải dùng nút Hoàn thành).
    const illegalDone = tasks.find((t) => t.status === 'Hoàn thành' && !doneByCode.has(t.task_code));
    if (illegalDone) {
      return bail(400, `Dùng nút "Hoàn thành" để hoàn thành dòng ${illegalDone.stage} — không đặt trạng thái Hoàn thành khi lưu phân công.`);
    }

    // §3.3: ràng buộc cấu trúc công đoạn theo loại sản phẩm
    const structErr = orderStructureError(po.product_type, tasks.map(t => t.stage), po.product_types);
    if (structErr) return bail(400, structErr);

    // Ràng buộc 150% (đồng bộ với frontend, chặn cả khi gọi API trực tiếp):
    const cap = Number(po.quantity) * 1.5;
    const badPlan = tasks.find(t => (Number(t.quantity) || 0) > cap + 1e-6);
    if (badPlan) return bail(400, `Sản lượng một lần (${badPlan.stage} ${Number(badPlan.quantity)}) vượt quá 150% SL cần sản xuất (${po.quantity} → tối đa ${cap}).`);
    const actByStage = {};
    tasks.forEach(t => { actByStage[t.stage] = (actByStage[t.stage] || 0) + (Number(t.actual_qty) || 0); });
    const badAct = Object.entries(actByStage).find(([, s]) => s > cap + 1e-6);
    if (badAct) return bail(400, `SL thực cộng dồn công đoạn ${badAct[0]} (${badAct[1]}) vượt quá 150% SL cần sản xuất (${po.quantity} → tối đa ${cap}).`);

    await client.query(`DELETE FROM production_tasks WHERE production_order_id = $1`, [poId]);
    let n = 1;
    for (const t of tasks) {
      const done = t.task_code && doneByCode.get(t.task_code);
      if (done) {
        // Giữ NGUYÊN bản ghi cũ của dòng đã hoàn thành (bỏ qua mọi sửa đổi từ payload).
        await client.query(`
          INSERT INTO production_tasks
            (production_order_id, task_code, stage, quantity, actual_qty, scrap_qty, machine_id, shift, planned_date, planned_end_date, assigned_team, assigned_worker, status, seq, note, assigned_worker_id, posted_qty, output_product_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [poId, done.task_code, done.stage, done.quantity, done.actual_qty, done.scrap_qty,
           done.machine_id, done.shift, done.planned_date, done.planned_end_date,
           done.assigned_team, done.assigned_worker, 'Hoàn thành', n, done.note, done.assigned_worker_id, done.posted_qty, done.output_product_id]);
        n++;
        continue;
      }
      const plan = Number(t.quantity) || 0;
      const act = t.actual_qty === '' || t.actual_qty == null ? null : Number(t.actual_qty);
      let st = t.status || 'Chờ';
      if (st === 'Hoàn thành') st = 'Đang sản xuất'; // an toàn: không bao giờ hoàn thành qua đường này
      // Dòng đã có (task_code trùng, chưa hoàn thành) → giữ mã; dòng mới → mã mới. Chưa hoàn thành ⇒ posted_qty = 0.
      const prev = t.task_code && prevRows.find(r => r.task_code === t.task_code);
      const code = prev ? prev.task_code : `${po.order_code}-${++maxSuffix}`;
      await client.query(`
        INSERT INTO production_tasks
          (production_order_id, task_code, stage, quantity, actual_qty, scrap_qty, machine_id, shift, planned_date, planned_end_date, assigned_team, assigned_worker, status, seq, note, assigned_worker_id, posted_qty, output_product_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,$17)`,
        [poId, code, t.stage, plan,
         act, t.scrap_qty || 0,
         t.machine_id || null, t.shift || null,
         t.planned_date || null, t.planned_end_date || t.planned_date || null,
         t.assigned_team || null, t.assigned_worker || null, st, n, t.note || null, t.assigned_worker_id || null,
         t.output_product_id || null]);
      n++;
    }
    await recomputeOrder(client, poId);
    await client.query('COMMIT');
    res.json({ message: 'Đã lưu phân công', count: tasks.length });
  } catch (err) {
    await client.query('ROLLBACK'); console.error(err);
    res.status(500).json({ message: err.detail || err.message || 'Lỗi khi lưu phân công' });
  } finally { client.release(); }
};

// GET /api/production-orders/:id/roll-availability — tồn cuộn khả dụng ở BTP khớp thông số lệnh
// (ưu tiên lô của chính lệnh, rồi FIFO) — cho màn Cắt.
exports.rollAvailability = async (req, res) => {
  try {
    const po = (await db.query(
      `SELECT po.id, po.order_code, po.product_id, po.specs, p.product_type FROM production_orders po
       JOIN products p ON p.id = po.product_id WHERE po.id = $1 AND po.is_deleted = FALSE`, [req.params.id])).rows[0];
    if (!po) return res.status(404).json({ message: 'Không tìm thấy lệnh sản xuất' });
    // Cuộn khả dụng = sản phẩm đầu ra của dòng Thổi trong lệnh (mặc định cấu hình nếu chưa có Thổi)
    let rollId; try { rollId = await resolveCutRollProduct(db, po); } catch { rollId = null; }
    if (!rollId) return res.json({ data: { spec_label: specLabel(po.specs), total_kg: 0, lots: [] } });
    const specKey = buildSpecKey(po.specs || {});
    const { rows } = await db.query(`
      SELECT s.lot_code, s.quantity::numeric AS qty, s.created_at, w.name AS location
      FROM inventory_stock s
      JOIN locations l  ON l.id = s.location_id
      JOIN warehouses w ON w.id = l.warehouse_id
      WHERE s.product_id = $1 AND s.spec_key = $2 AND w.warehouse_type = 'BTP' AND s.quantity > 0
      ORDER BY (s.lot_code = $3) DESC, s.created_at ASC`, [rollId, specKey, po.order_code]);
    const total = rows.reduce((s, r) => s + Number(r.qty), 0);
    res.json({ data: { spec_label: specLabel(po.specs), total_kg: total,
      lots: rows.map(r => ({ lot_code: r.lot_code, location: r.location, qty: Number(r.qty), created_at: r.created_at, is_own: r.lot_code === po.order_code })) } });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy tồn cuộn khả dụng' }); }
};

// POST /api/production-orders/:id/complete-tasks — hoàn thành nhiều dòng phân công trong MỘT transaction.
// Body: { tasks: [{ task_code, roll_finish_lots?: string[] }] }. Thiếu máy/công nhân/SL thực → chặn, không ghi dòng nào.
exports.completeTasks = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const poId = req.params.id;
    const items = Array.isArray(req.body.tasks) ? req.body.tasks.filter(t => t && t.task_code) : [];
    if (!items.length) return res.status(400).json({ message: 'Chưa chọn dòng nào để hoàn thành.' });
    const finishByCode = new Map(items.map(it => [it.task_code, Array.isArray(it.roll_finish_lots) ? it.roll_finish_lots : []]));

    await client.query('BEGIN');
    const bail = async (code, message) => { await client.query('ROLLBACK'); return res.status(code).json({ message }); };
    const po = (await client.query(
      `SELECT po.id, po.order_code, po.product_id, po.unit, po.specs, po.status, p.product_type, p.product_code
       FROM production_orders po JOIN products p ON p.id = po.product_id
       WHERE po.id = $1 AND po.is_deleted = FALSE FOR UPDATE OF po`, [poId])).rows[0];
    if (!po) return bail(404, 'Không tìm thấy lệnh sản xuất');
    if (po.status === 'Đã hủy') return bail(400, 'Lệnh đã Hủy — không hoàn thành được.');

    const rawCodes = [...finishByCode.keys()];
    const rows = (await client.query(
      `SELECT * FROM production_tasks WHERE production_order_id = $1 AND task_code = ANY($2::text[]) FOR UPDATE`,
      [poId, rawCodes])).rows;
    const byCode = new Map(rows.map(r => [r.task_code, r]));
    // Ghi kho Thổi TRƯỚC Cắt (bất kể thứ tự client gửi): cuộn vừa thổi phải có trong BTP để Cắt cùng đợt trừ được.
    const stageRank = (c) => { const s = byCode.get(c)?.stage; return s === 'Thổi' ? 0 : s === 'Cắt' ? 2 : 1; };
    const codes = [...rawCodes].sort((a, b) => stageRank(a) - stageRank(b));

    // Kiểm tra TẤT CẢ trước (báo gộp), rồi mới ghi — thiếu một dòng thì không dòng nào được ghi.
    const problems = [];
    for (const code of codes) {
      const t = byCode.get(code);
      if (!t) { problems.push(`${code} (không tìm thấy)`); continue; }
      if (t.status === 'Hoàn thành') { problems.push(`${code} (đã hoàn thành)`); continue; }
      const lacks = [];
      if (!t.machine_id) lacks.push('máy');
      if (!t.assigned_worker) lacks.push('công nhân');
      if (!(Number(t.actual_qty) > 0)) lacks.push('SL thực');
      if (lacks.length) problems.push(`${t.stage} ${code} (thiếu: ${lacks.join(', ')})`);
    }
    if (problems.length) return bail(400, `Không thể hoàn thành — các dòng chưa đủ điều kiện: ${problems.join('; ')}.`);

    for (const code of codes) {
      const t = byCode.get(code);
      const outQty = await postTaskStock(client, po, t, finishByCode.get(code) || []);
      await client.query(`UPDATE production_tasks SET status = 'Hoàn thành', posted_qty = $2 WHERE id = $1`, [t.id, outQty]);
    }
    const result = await recomputeOrder(client, poId);
    await client.query('COMMIT');
    res.json({ message: `Đã hoàn thành ${codes.length} dòng`, ...result });
  } catch (err) {
    await client.query('ROLLBACK'); console.error(err);
    res.status(400).json({ message: err.detail || err.message || 'Lỗi khi hoàn thành phân công' });
  } finally { client.release(); }
};

// POST /api/production/tasks/:taskId/reopen — Admin "Hủy hoàn thành" một dòng, hoàn kho đúng như đã ghi.
exports.reopenTask = async (req, res) => {
  const client = await db.pool.connect();
  try {
    if (!req.user || !req.user.is_admin) return res.status(403).json({ message: 'Chỉ Admin được hủy hoàn thành.' });
    const taskId = req.params.taskId;
    await client.query('BEGIN');
    const bail = async (code, message) => { await client.query('ROLLBACK'); return res.status(code).json({ message }); };
    const row = (await client.query(
      `SELECT t.*, po.order_code, po.product_id, po.specs, p.product_type
       FROM production_tasks t
       JOIN production_orders po ON po.id = t.production_order_id AND po.is_deleted = FALSE
       JOIN products p ON p.id = po.product_id
       WHERE t.id = $1 FOR UPDATE OF t, po`, [taskId])).rows[0];
    if (!row) return bail(404, 'Không tìm thấy dòng phân công');
    if (row.status !== 'Hoàn thành') return bail(400, 'Dòng chưa Hoàn thành — không cần hủy.');

    const q = Number(row.posted_qty) || 0;
    const specs = row.specs || {};
    const specKey = buildSpecKey(specs);
    const btpLoc = await locOf(client, 'BTP');
    const tpLoc = await locOf(client, 'TP');
    const rollId = await getRollProductId(client);

    if (row.stage === 'Thổi') {
      const outProduct = row.output_product_id || (row.product_type === 'Bán thành phẩm' ? row.product_id : rollId);
      const cur = (await client.query(
        `SELECT COALESCE(quantity,0) AS q FROM inventory_stock
         WHERE product_id = $1 AND location_id = $2 AND spec_key = $3 AND lot_code = $4`,
        [outProduct, btpLoc, specKey, row.order_code])).rows[0];
      if (!cur || Number(cur.q) < q - 1e-6) {
        return bail(400, 'Cuộn của lần thổi này đã được cắt / bán — hãy "Hủy hoàn thành" dòng Cắt trước.');
      }
      await applyStock(client, {
        product_id: outProduct, location_id: btpLoc, delta: -q, unit: 'kg', specs, spec_key: specKey,
        lot_code: row.order_code, prod_order_id: row.production_order_id, clampZero: true,
        trx_type: 'Điều chỉnh', ref_code: row.order_code, note: `Hủy hoàn thành Thổi — ${row.task_code}`,
      });
    } else if (row.stage === 'Cắt') {
      const cutOutput = row.output_product_id || row.product_id; // bao bì đầu ra đã nhập TP
      const cur = (await client.query(
        `SELECT COALESCE(quantity,0) AS q FROM inventory_stock
         WHERE product_id = $1 AND location_id = $2 AND spec_key = $3 AND lot_code = $4`,
        [cutOutput, tpLoc, specKey, row.order_code])).rows[0];
      if (!cur || Number(cur.q) < q - 1e-6) {
        return bail(400, 'Bao bì của lần cắt này đã được giao / dùng tiếp — không hủy hoàn thành được.');
      }
      // Trừ lại bao bì ở TP
      await applyStock(client, {
        product_id: cutOutput, location_id: tpLoc, delta: -q, unit: 'kg', specs, spec_key: specKey,
        lot_code: row.order_code, prod_order_id: row.production_order_id, clampZero: true,
        trx_type: 'Điều chỉnh', ref_code: row.order_code, note: `Hủy hoàn thành Cắt — ${row.task_code}` });
      // Hoàn lại cuộn vào đúng lô đã trừ (gồm cả phần hao hụt)
      const usage = (await client.query(
        `SELECT * FROM production_roll_usage WHERE production_order_id = $1 AND task_code = $2`,
        [row.production_order_id, row.task_code])).rows;
      for (const u of usage) {
        const back = Number(u.qty_used) + Number(u.qty_written_off);
        if (back > 1e-6) await applyStock(client, {
          product_id: u.roll_product_id, location_id: u.location_id, delta: back, unit: 'kg',
          specs: u.specs || specs, spec_key: u.spec_key, lot_code: u.lot_code,
          prod_order_id: row.production_order_id, clampZero: false,
          trx_type: 'Điều chỉnh', ref_code: row.order_code, note: `Hoàn cuộn (hủy hoàn thành Cắt ${row.task_code})` });
      }
      await client.query(`DELETE FROM production_roll_usage WHERE production_order_id = $1 AND task_code = $2`,
        [row.production_order_id, row.task_code]);
    }

    await client.query(`UPDATE production_tasks SET status = 'Đang sản xuất', posted_qty = 0 WHERE id = $1`, [taskId]);
    await recomputeOrder(client, row.production_order_id);
    await client.query('COMMIT');
    res.json({ message: 'Đã hủy hoàn thành dòng và hoàn kho.' });
  } catch (err) {
    await client.query('ROLLBACK'); console.error(err);
    res.status(400).json({ message: err.detail || err.message || 'Lỗi khi hủy hoàn thành' });
  } finally { client.release(); }
};
