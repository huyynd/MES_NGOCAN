// backend/controllers/planningController.js
const db = require('../../core/db');

/**
 * GET /api/planning/groups
 * Gom nhóm các lệnh sản xuất theo (Màu sắc + Kích thước) để chạy hàng loạt,
 * giảm phế phẩm do súc rửa / chuyển đổi máy (changeover).
 * Mỗi nhóm trả về tổng số lượng + danh sách lệnh, ưu tiên theo ngày giao gần nhất.
 */
exports.groups = async (req, res) => {
  try {
    // Lọc theo nhóm trạng thái (status=comma-list). Mặc định: lệnh chưa lên lịch xong.
    const params = [];
    let statusFilter = '';
    if (req.query.status) {
      const sts = req.query.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (sts.length) { params.push(sts); statusFilter = `AND po.status = ANY($1)`; }
    } else if (req.query.pending !== 'false') {
      statusFilter = `AND po.status IN ('Chờ duyệt','Đã lên kế hoạch','Chờ nguyên vật liệu')`;
    }
    const { rows } = await db.query(`
      SELECT po.id, po.order_code, po.quantity, po.unit, po.due_date, po.status,
             po.attr_color, po.attr_size, po.attr_thickness, po.group_key,
             po.machine_id, po.planned_date, po.shift, po.priority,
             p.product_name, p.product_code, c.name AS customer_name, m.name AS machine_name,
             (SELECT COUNT(*)::int FROM production_tasks t WHERE t.production_order_id = po.id) AS task_count,
             COALESCE((SELECT MIN(t3.planned_date) FROM production_tasks t3 WHERE t3.production_order_id = po.id AND t3.planned_date IS NOT NULL), po.planned_date) AS planned_date_display,
             COALESCE(NULLIF((SELECT STRING_AGG(DISTINCT t4.shift, ', ') FROM production_tasks t4 WHERE t4.production_order_id = po.id AND t4.shift IS NOT NULL AND t4.shift != ''), ''), po.shift) AS shift_display,
             COALESCE((SELECT STRING_AGG(DISTINCT m2.name, ', ') FROM production_tasks t2 JOIN machines m2 ON m2.id = t2.machine_id WHERE t2.production_order_id = po.id AND t2.machine_id IS NOT NULL), m.name) AS machine_name_display,
             COALESCE((SELECT SUM(COALESCE(t.actual_qty, t.quantity)) FROM production_tasks t
                       WHERE t.production_order_id = po.id AND t.status = 'Hoàn thành'
                         AND t.stage = (CASE WHEN EXISTS (SELECT 1 FROM production_tasks tf WHERE tf.production_order_id = po.id AND tf.stage = 'Cắt') THEN 'Cắt' ELSE 'Thổi' END)), 0) AS produced_qty
      FROM production_orders po
      JOIN products p ON p.id = po.product_id
      LEFT JOIN customers c ON c.id = po.customer_id
      LEFT JOIN machines m ON m.id = po.machine_id
      WHERE po.is_deleted = FALSE ${statusFilter}
      ORDER BY CASE WHEN po.priority = 'Cao' THEN 1 WHEN po.priority = 'Trung bình' THEN 2 ELSE 3 END, po.due_date NULLS LAST, po.created_at
    `, params);

    const map = new Map();
    for (const r of rows) {
      const key = r.group_key || `${r.attr_color || ''}|${r.attr_size || ''}`;
      if (!map.has(key)) {
        map.set(key, {
          group_key: key,
          attr_color: r.attr_color, attr_size: r.attr_size, has_high_priority: false,
          order_count: 0, total_quantity: 0, total_produced: 0, earliest_due: null, orders: [],
        });
      }
      const g = map.get(key);
      g.orders.push(r);
      g.order_count += 1;
      g.total_quantity += Number(r.quantity) || 0;
      g.total_produced += Number(r.produced_qty) || 0;
      if (r.due_date && (!g.earliest_due || r.due_date < g.earliest_due)) g.earliest_due = r.due_date;
      if (r.priority === 'Cao') g.has_high_priority = true;
    }
    // sắp nhóm theo độ ưu tiên rồi ngày giao sớm nhất
    const groups = [...map.values()].sort((a, b) => {
      if (a.has_high_priority && !b.has_high_priority) return -1;
      if (!a.has_high_priority && b.has_high_priority) return 1;
      if (!a.earliest_due) return 1; if (!b.earliest_due) return -1;
      return a.earliest_due < b.earliest_due ? -1 : 1;
    });
    res.json({ groups, total_orders: rows.length });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi gom nhóm kế hoạch' }); }
};

/**
 * GET /api/planning/from-orders
 * Lập kế hoạch TỪ ĐƠN HÀNG: lấy các dòng đơn hàng còn mở & chưa lên kế hoạch,
 * gom thành lô theo (sản phẩm + màu + kích thước + độ dày),
 * sắp xếp các lô theo NGÀY GIAO sớm nhất (ưu tiên #1).
 */
exports.fromOrders = async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT it.id AS item_id, it.product_id, it.quantity, it.planned_qty, it.unit,
             (it.quantity - it.planned_qty) AS remaining,
             it.specs, it.spec_key, it.attr_size, it.attr_thickness, it.attr_color, it.note, it.material_type, it.mix_ratio,
             so.id AS sales_order_id, so.order_code, so.due_date, so.customer_id, so.priority,
             c.name AS customer_name, p.product_name, p.product_code
      FROM sales_order_items it
      JOIN sales_orders so ON so.id = it.sales_order_id
      JOIN products p ON p.id = it.product_id
      LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.is_deleted = FALSE AND so.status IN ('Mới','Đang sản xuất')
        AND (it.quantity - it.planned_qty) > 0
      ORDER BY CASE WHEN so.priority = 'Cao' THEN 1 WHEN so.priority = 'Trung bình' THEN 2 ELSE 3 END, so.due_date NULLS LAST, so.created_at
    `);

    const map = new Map();
    for (const r of rows) {
      const key = [r.product_id, r.spec_key || ''].join('||');
      if (!map.has(key)) {
        map.set(key, {
          batch_key: key, product_id: r.product_id, product_name: r.product_name, product_code: r.product_code,
          specs: r.specs || {}, spec_key: r.spec_key, has_high_priority: false,
          attr_color: r.attr_color, attr_size: r.attr_size, attr_thickness: r.attr_thickness,
          unit: r.unit, total_quantity: 0, earliest_due: null, items: [],
        });
      }
      const g = map.get(key);
      g.items.push(r);
      g.total_quantity += Number(r.remaining) || 0;
      if (r.due_date && (!g.earliest_due || r.due_date < g.earliest_due)) g.earliest_due = r.due_date;
      if (r.priority === 'Cao') g.has_high_priority = true;
    }
    const batches = [...map.values()].sort((a, b) => {
      if (a.has_high_priority && !b.has_high_priority) return -1;
      if (!a.has_high_priority && b.has_high_priority) return 1;
      if (!a.earliest_due) return 1; if (!b.earliest_due) return -1;
      return a.earliest_due < b.earliest_due ? -1 : 1;
    });
    res.json({ batches, demand_lines: rows.length });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lập kế hoạch từ đơn hàng' }); }
};

/**
 * POST /api/planning/generate
 * Sinh lệnh sản xuất từ các dòng nhu cầu đã chọn + phân bổ nguồn lực (máy/ngày/ca).
 * Mỗi dòng đơn hàng → 1 lệnh SX (truy ngược qua sales_order_item_id),
 * cùng lô được gán cùng máy/ca để chạy liền nhau (giảm changeover).
 */
exports.generate = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { items: planItems, item_ids, machine_id, planned_date, shift, assigned_team, assigned_worker } = req.body;
    // Phân bổ theo từng công đoạn: [{stage, name, machine_id, shift, assigned_team, assigned_worker}]
    const stages = Array.isArray(req.body.stages) ? req.body.stages.filter((s) => s && s.stage) : [];
    // Hỗ trợ cả 2 dạng: items[{item_id, qty}] (lập một phần) hoặc item_ids[] (lập hết phần còn lại)
    const list = Array.isArray(planItems) && planItems.length
      ? planItems
      : (Array.isArray(item_ids) ? item_ids.map((id) => ({ item_id: id })) : []);
    if (!list.length) return res.status(400).json({ message: 'Chưa chọn dòng nhu cầu để tạo lệnh' });
    const ids = list.map((x) => x.item_id);
    const qtyById = Object.fromEntries(list.map((x) => [x.item_id, x.qty]));

    await client.query('BEGIN');
    const items = (await client.query(`
      SELECT it.*, so.customer_id, so.due_date, so.id AS so_id, so.priority
      FROM sales_order_items it JOIN sales_orders so ON so.id = it.sales_order_id
      WHERE it.id = ANY($1::uuid[])`, [ids])).rows;

    // Máy/trạng thái cấp lệnh: nếu phân bổ theo công đoạn thì lấy máy của công đoạn đầu để hiển thị
    const headMachine = machine_id || (stages[0] && stages[0].machine_id) || null;
    const status = (headMachine || stages.length) ? 'Đã lên kế hoạch' : 'Chờ duyệt';

    // Công đoạn MẶC ĐỊNH: luôn Thổi + Cắt (chủ dự án chốt 2026-10-09 — không chia theo loại SP vì
    // 1 SP có thể vừa TP vừa BTP; không dùng Quy trình công nghệ). Đồng bộ src/productionDefaults.js.
    // Chỉ là gợi ý ban đầu: thừa công đoạn nào người dùng xóa ở màn LSX.
    const DEFAULT_STAGES = ['Thổi', 'Cắt'].map((stage) => ({
      stage, name: stage, assigned_team: stage === 'Cắt' ? 'Nhà máy cắt' : 'Nhà máy thổi',
      machine_id: null, shift: null, assigned_worker: null,
    }));

    const created = [];
    for (const it of items) {
      const remaining = Number(it.quantity) - Number(it.planned_qty || 0);
      let q = qtyById[it.id];
      q = (q === undefined || q === null || q === '') ? remaining : Number(q);
      if (!(q > 0)) continue;                 // bỏ qua dòng không nhập SL
      if (q > remaining) q = remaining;       // không vượt quá số còn lại
      const gk = [it.product_id, it.spec_key || ''].join('||');
      const r = await client.query(`
        INSERT INTO production_orders
          (sales_order_id, sales_order_item_id, customer_id, product_id, quantity, unit,
           specs, spec_key, attr_size, attr_thickness, attr_color, machine_id, planned_date, shift, assigned_team, group_key, due_date, status, assigned_worker, material_type, mix_ratio, priority, note)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23) RETURNING id, order_code`,
        [it.so_id, it.id, it.customer_id, it.product_id, q, it.unit,
         JSON.stringify(it.specs || {}), it.spec_key || '',
         it.attr_size, it.attr_thickness, it.attr_color, headMachine, planned_date || null,
         shift || null, assigned_team || null, gk, it.due_date, status, assigned_worker || null, it.material_type || null, JSON.stringify(it.mix_ratio || []), it.priority || 'Trung bình', it.note || null]);
      const po = r.rows[0];
      created.push(po.order_code);

      // Tạo sẵn công đoạn (production_tasks) theo phân bổ từng công đoạn — mỗi công đoạn làm đủ SL (nối tiếp)
      // Có truyền stages từ frontend → dùng đúng như người dùng chọn; không có → mặc định Thổi + Cắt
      const effectiveStages = stages.length > 0 ? stages : DEFAULT_STAGES;
      let n = 1;
      for (const s of effectiveStages) {
        await client.query(`
          INSERT INTO production_tasks
            (production_order_id, task_code, stage, quantity, machine_id, shift, planned_date, planned_end_date, assigned_team, assigned_worker, status, seq, note)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [po.id, `${po.order_code}-${n}`, s.stage, q, s.machine_id || null, s.shift || null,
           planned_date || null, planned_date || null, s.assigned_team || null, s.assigned_worker || null,
           'Chờ', n, s.name || null]);
        n++;
      }
      const newPlanned = Number(it.planned_qty || 0) + q;
      await client.query(
        `UPDATE sales_order_items SET planned_qty = $1, is_planned = ($1 >= quantity) WHERE id = $2`,
        [newPlanned, it.id]);
    }

    const soIds = Array.from(new Set(items.map(it => it.so_id)));
    if (soIds.length > 0) {
      await client.query(`UPDATE sales_orders SET status = 'Đang sản xuất' WHERE id = ANY($1::uuid[]) AND status = 'Mới'`, [soIds]);
    }

    await client.query('COMMIT');
    res.status(201).json({ created });
  } catch (err) {
    await client.query('ROLLBACK'); console.error(err);
    res.status(500).json({ message: err.detail || 'Lỗi khi sinh lệnh sản xuất từ kế hoạch' });
  } finally { client.release(); }
};

/**
 * GET /api/planning/material-requirements
 * Tính nhu cầu NVL = Σ (lệnh sản xuất × định mức BOM), trừ tồn kho ⇒ lượng cần mua.
 * Giải quyết pain point: "tính & lên kế hoạch số lượng NVL cần mua sắm".
 */
exports.materialRequirements = async (req, res) => {
  try {
    // 1) Lệnh SX cần sản xuất
    const orders = (await db.query(`
      SELECT po.id, po.order_code, po.product_id, po.quantity, p.product_name
      FROM production_orders po JOIN products p ON p.id = po.product_id
      WHERE po.is_deleted = FALSE AND po.status IN ('Chờ duyệt','Đã lên kế hoạch','Chờ nguyên vật liệu','Đang sản xuất')
    `)).rows;

    // 2) BOM mới nhất còn hiệu lực cho mỗi sản phẩm đầu ra
    const bomHeads = (await db.query(`
      SELECT DISTINCT ON (product_id) id, product_id, output_quantity
      FROM boms WHERE is_deleted = FALSE AND status = 'Hoạt động'
      ORDER BY product_id, created_at DESC
    `)).rows;
    const bomByProduct = new Map(bomHeads.map(b => [b.product_id, b]));

    // 3) Dòng định mức của các BOM đó
    const bomIds = bomHeads.map(b => b.id);
    let lines = [];
    if (bomIds.length) {
      lines = (await db.query(`
        SELECT l.bom_id, l.material_id, l.quantity, l.unit,
               p.product_name AS material_name, p.product_code AS material_code, p.unit AS material_unit
        FROM bom_lines l JOIN products p ON p.id = l.material_id
        WHERE l.bom_id = ANY($1::uuid[])
      `, [bomIds])).rows;
    }
    const linesByBom = new Map();
    for (const l of lines) {
      if (!linesByBom.has(l.bom_id)) linesByBom.set(l.bom_id, []);
      linesByBom.get(l.bom_id).push(l);
    }

    // 4) Tồn kho hiện có theo NVL
    const stock = (await db.query(`SELECT product_id, SUM(quantity)::numeric AS qty FROM inventory_stock GROUP BY product_id`)).rows;
    const onHand = new Map(stock.map(s => [s.product_id, Number(s.qty)]));

    // 5) Cộng dồn nhu cầu
    const req_map = new Map(); // material_id -> {..., required}
    const missingBom = [];
    for (const o of orders) {
      const bom = bomByProduct.get(o.product_id);
      if (!bom) { missingBom.push({ order_code: o.order_code, product_name: o.product_name }); continue; }
      const factor = Number(o.quantity) / (Number(bom.output_quantity) || 1);
      for (const l of (linesByBom.get(bom.id) || [])) {
        const need = Number(l.quantity) * factor;
        if (!req_map.has(l.material_id)) {
          req_map.set(l.material_id, {
            material_id: l.material_id, material_code: l.material_code, material_name: l.material_name,
            unit: l.unit || l.material_unit, required_qty: 0,
            on_hand_qty: onHand.get(l.material_id) || 0,
          });
        }
        req_map.get(l.material_id).required_qty += need;
      }
    }
    const requirements = [...req_map.values()].map(r => ({
      ...r,
      required_qty: Math.round(r.required_qty * 1000) / 1000,
      to_purchase_qty: Math.max(0, Math.round((r.required_qty - r.on_hand_qty) * 1000) / 1000),
    })).sort((a, b) => b.to_purchase_qty - a.to_purchase_qty);

    res.json({ requirements, missing_bom: missingBom, order_count: orders.length });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi tính nhu cầu NVL' }); }
};
