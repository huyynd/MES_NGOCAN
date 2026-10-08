const db = require('../../core/db');

// L67: "Đã sản xuất" của một lệnh = Σ lần HOÀN THÀNH ở CÔNG ĐOẠN CUỐI (có Cắt → Cắt, không → Thổi).
// Cùng định nghĩa với recomputeOrder / produced_qty ở productionController. Trước đây cộng mọi
// công đoạn, mọi trạng thái → lệnh Thổi 1000 + Cắt 1000 báo "đã SX 2000" (200%), lại cộng kg với cái.
const DONE_BY_ORDER = `
        SELECT t.production_order_id, SUM(COALESCE(t.actual_qty, t.quantity)) AS done_qty
        FROM production_tasks t
        WHERE t.status = 'Hoàn thành'
          AND t.stage = (CASE WHEN EXISTS (SELECT 1 FROM production_tasks tf
                                           WHERE tf.production_order_id = t.production_order_id AND tf.stage = 'Cắt')
                              THEN 'Cắt' ELSE 'Thổi' END)
        GROUP BY t.production_order_id`;

exports.kpi = async (req, res) => {
  try {
    const kpi = await db.query(`
      SELECT
        (SELECT COUNT(*)::int FROM production_orders WHERE is_deleted = FALSE) AS total_production_orders,
        (SELECT COUNT(*)::int FROM production_orders WHERE is_deleted = FALSE AND status = 'Đang sản xuất') AS active_production_orders,
        (SELECT COUNT(*)::int FROM machines WHERE is_deleted = FALSE AND status = 'Hoạt động') AS active_machines,
        (SELECT COALESCE(SUM(quantity), 0) FROM inventory_stock) AS total_inventory_items
    `);
    const trendQuery = await db.query(`
      WITH dates AS (
        SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval)::date AS d
      )
      SELECT to_char(d.d, 'DD/MM') AS date,
             COALESCE(SUM(pt.quantity), 0) AS plan_qty,
             COALESCE(SUM(pt.actual_qty), 0) AS actual_qty
      FROM dates d
      LEFT JOIN production_tasks pt ON pt.planned_date = d.d
      GROUP BY d.d
      ORDER BY d.d
    `);
    const statusQuery = await db.query(`SELECT status AS name, COUNT(*)::int AS value FROM production_orders WHERE is_deleted = FALSE GROUP BY status`);
    const productQuery = await db.query(`
      SELECT p.product_name AS name, SUM(po.quantity) AS plan_qty
      FROM production_orders po JOIN products p ON p.id = po.product_id WHERE po.is_deleted = FALSE GROUP BY p.product_name ORDER BY plan_qty DESC LIMIT 5
    `);
    const inventoryQuery = await db.query(`SELECT p.product_types->>0 AS name, SUM(s.quantity) AS value FROM inventory_stock s JOIN products p ON p.id = s.product_id GROUP BY p.product_types->>0`);
    const invAlertQuery = await db.query(`
      WITH stock_per_wh AS (
        SELECT s.product_id, l.warehouse_id, SUM(s.quantity) AS qty
        FROM inventory_stock s
        JOIN locations l ON l.id = s.location_id
        GROUP BY s.product_id, l.warehouse_id
      ),
      product_limits AS (
        SELECT id AS product_id,
               (jsonb_array_elements(warehouse_limits)->>'warehouse_id')::uuid AS warehouse_id,
               (jsonb_array_elements(warehouse_limits)->>'min_quantity')::numeric AS min_quantity
        FROM products
        WHERE warehouse_limits IS NOT NULL AND jsonb_array_length(warehouse_limits) > 0
      )
      SELECT COUNT(DISTINCT pl.product_id)::int AS count
      FROM product_limits pl
      LEFT JOIN stock_per_wh spw ON pl.product_id = spw.product_id AND pl.warehouse_id = spw.warehouse_id
      WHERE COALESCE(spw.qty, 0) < pl.min_quantity
    `);
    const qualityQuery = await db.query(`SELECT COALESCE(SUM(actual_qty),0) AS passed, COALESCE(SUM(scrap_qty),0) AS failed FROM production_tasks WHERE actual_qty > 0 OR scrap_qty > 0`);

    res.json({
      kpi: kpi.rows[0],
      charts: {
        trend: trendQuery.rows,
        status: statusQuery.rows,
        products: productQuery.rows,
        inventory: inventoryQuery.rows,
        inventoryAlert: invAlertQuery.rows[0].count,
        quality: qualityQuery.rows[0]
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy dữ liệu KPI' });
  }
};

exports.detailed = async (req, res) => {
  try {
    const { fromDate, toDate, orderCode, productId, status } = req.query;

    // Build filter conditions
    const params = [];
    const conditions = ['po.is_deleted = FALSE'];

    if (fromDate && toDate) {
      params.push(fromDate, toDate);
      conditions.push(`po.created_at::date >= $${params.length - 1} AND po.created_at::date <= $${params.length}`);
    }
    if (orderCode) {
      params.push(`%${orderCode}%`);
      conditions.push(`po.order_code ILIKE $${params.length}`);
    }
    if (productId) {
      params.push(productId);
      conditions.push(`po.product_id = $${params.length}`);
    }
    if (status && status !== 'Tất cả') {
      params.push(status);
      conditions.push(`po.status = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');

    // Summary stats
    const summaryQuery = await db.query(`
      SELECT
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(po.quantity), 0) AS total_plan_qty,
        COALESCE(SUM(COALESCE(pt.done_qty, 0)), 0) AS total_done_qty,
        COUNT(*) FILTER (WHERE po.status = 'Đang sản xuất')::int AS in_production,
        COUNT(*) FILTER (WHERE po.due_date < CURRENT_DATE AND po.status NOT IN ('Hoàn thành', 'Đã hủy'))::int AS overdue
      FROM production_orders po
      LEFT JOIN (
        ${DONE_BY_ORDER}
      ) pt ON pt.production_order_id = po.id
      WHERE ${whereClause}
    `, params);

    // Chart 1: Quantity by status (bar chart)
    const byStatusQuery = await db.query(`
      SELECT po.status, COALESCE(SUM(po.quantity), 0) AS plan_qty,
             COALESCE(SUM(COALESCE(pt.done_qty, 0)), 0) AS done_qty,
             COUNT(*)::int AS cnt
      FROM production_orders po
      LEFT JOIN (
        ${DONE_BY_ORDER}
      ) pt ON pt.production_order_id = po.id
      WHERE ${whereClause}
      GROUP BY po.status
    `, params);

    // Chart 2: Plan vs Done over time (line chart, group by planned_date)
    const trendQuery = await db.query(`
      SELECT to_char(po.planned_date, 'DD/MM') AS date,
             COALESCE(SUM(po.quantity), 0) AS plan_qty,
             COALESCE(SUM(COALESCE(pt.done_qty, 0)), 0) AS done_qty
      FROM production_orders po
      LEFT JOIN (
        ${DONE_BY_ORDER}
      ) pt ON pt.production_order_id = po.id
      WHERE ${whereClause}
      GROUP BY po.planned_date
      ORDER BY po.planned_date
    `, params);

    // Chart 3: Status distribution (donut)
    const statusDistQuery = await db.query(`
      SELECT po.status AS name, COUNT(*)::int AS value
      FROM production_orders po
      WHERE ${whereClause}
      GROUP BY po.status
    `, params);

    // Main list
    const detailedQuery = await db.query(`
      SELECT po.id, po.order_code, po.quantity, po.unit, po.status,
             po.planned_date, po.due_date, po.note,
             p.product_name, c.name AS customer_name,
             COALESCE(pt.done_qty, 0) AS actual_qty
      FROM production_orders po
      JOIN products p ON p.id = po.product_id
      LEFT JOIN customers c ON c.id = po.customer_id
      LEFT JOIN (
        ${DONE_BY_ORDER}
      ) pt ON pt.production_order_id = po.id
      WHERE ${whereClause}
      ORDER BY po.created_at DESC
      LIMIT 200
    `, params);

    // Products list for filter dropdown
    const productsQuery = await db.query(`
      SELECT id, product_name FROM products
      WHERE is_deleted = FALSE
      ORDER BY product_name
    `);

    // Order codes list for filter dropdown
    const orderCodesQuery = await db.query(`
      SELECT order_code, product_id, status FROM production_orders
      WHERE is_deleted = FALSE
      ORDER BY order_code DESC
    `);

    res.json({
      summary: summaryQuery.rows[0],
      charts: {
        byStatus: byStatusQuery.rows,
        trend: trendQuery.rows,
        statusDist: statusDistQuery.rows
      },
      data: detailedQuery.rows,
      products: productsQuery.rows,
      orderCodes: orderCodesQuery.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy dữ liệu chi tiết' });
  }
};

exports.machines = async (req, res) => {
  try {
    // Thống kê trạng thái máy
    const statusQuery = await db.query(`
      SELECT status, COUNT(*)::int AS count
      FROM machines
      WHERE is_deleted = FALSE
      GROUP BY status
    `);

    // Dữ liệu máy — chỉ dùng các cột thực sự tồn tại trong schema
    const machinesQuery = await db.query(`
      SELECT m.id, m.machine_code, m.name, m.factory, m.machine_type, m.status,
             COALESCE(m.capacity_per_hour, 0) AS capacity_per_hour,
             COUNT(t.id) FILTER (WHERE t.status = 'Hoàn thành')::int AS tasks_done,
             COUNT(t.id)::int AS tasks_total,
             COALESCE(SUM(t.actual_qty) FILTER (WHERE t.status = 'Hoàn thành'), 0) AS total_actual_qty
      FROM machines m
      LEFT JOIN production_tasks t ON t.machine_id = m.id
      WHERE m.is_deleted = FALSE
      GROUP BY m.id, m.machine_code, m.name, m.factory, m.machine_type, m.status, m.capacity_per_hour
      ORDER BY m.machine_code
    `);
    
    // Dự đoán sản lượng trong 7 ngày tới dựa trên capacity
    const predictionQuery = await db.query(`
       WITH next_7_days AS (
         SELECT generate_series(CURRENT_DATE, CURRENT_DATE + interval '6 days', interval '1 day')::date AS date
       )
       SELECT d.date, COALESCE(SUM(m.capacity_per_hour * 8), 0) AS predicted_output
       FROM next_7_days d
       CROSS JOIN machines m
       WHERE m.is_deleted = FALSE AND m.status = 'Hoạt động'
       GROUP BY d.date
       ORDER BY d.date
    `);

    res.json({
      status_distribution: statusQuery.rows,
      machine_stats: machinesQuery.rows,
      prediction: predictionQuery.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy dữ liệu máy móc' });
  }
};

// GET /reports/employees — tổng hợp hiệu suất từng nhân viên
exports.employees = async (req, res) => {
  try {
    const { fromDate, toDate, stage, shift, team, orderCode } = req.query;
    const params = []; let i = 1;
    
    const taskWhere = [];
    const scrapWhere = [];

    // Dùng COALESCE(updated_at::date, planned_date, ...) — ưu tiên ngày hoàn thành thực tế
    // để không bỏ sót lệnh được làm trong kỳ nhưng kế hoạch từ trước
    if (fromDate)  { 
      taskWhere.push(`COALESCE(updated_at::date, planned_date, po_planned_date, po_created_at::date) >= $${i}`); 
      scrapWhere.push(`dsr.record_date >= $${i}`);
      params.push(fromDate); 
      i++; 
    }
    if (toDate)    { 
      taskWhere.push(`COALESCE(updated_at::date, planned_date, po_planned_date, po_created_at::date) <= $${i}`); 
      scrapWhere.push(`dsr.record_date <= $${i}`);
      params.push(toDate); 
      i++; 
    }
    if (stage)     { taskWhere.push(`stage = $${i++}`); params.push(stage); }
    if (shift)     { taskWhere.push(`shift = $${i++}`); params.push(shift); }
    if (orderCode) { taskWhere.push(`order_code ILIKE $${i++}`); params.push(`%${orderCode}%`); }
    
    // Bỏ comment block này nếu muốn giới hạn nhân viên chỉ xem được hiệu suất của chính mình
    // Tuy nhiên, đối với màn hình Leaderboard (Top 5), thường cho phép xem hiệu suất của tất cả mọi người.
    /*
    if (req.user && req.user.linked_worker) {
      taskWhere.push(`final_worker = $${i}`);
      scrapWhere.push(`dsr.worker_name = $${i}`);
      params.push(req.user.linked_worker);
      i++;
    }
    */
    
    const taskWhereClause = taskWhere.length ? `AND ${taskWhere.join(' AND ')}` : '';
    const scrapWhereClause = scrapWhere.length ? `WHERE ${scrapWhere.join(' AND ')}` : '';

    // Điều kiện cho nhân viên
    const empWhere = [`e.is_deleted = FALSE`];
    if (team) {
      empWhere.push(`e.factory = $${i++}`);
      params.push(team);
    }

    const { rows } = await db.query(`
      WITH raw_tasks AS (
        SELECT COALESCE(t.id, po.id) AS id,
               po.id AS production_order_id,
               -- Kế hoạch: luôn dùng po.quantity (SL lệnh gốc) thay vì t.quantity
               -- Đơn gấp (priority='Cao') không có kế hoạch phân công nên t.quantity
               -- có thể là giá trị cũ/không phản ánh thực tế → dùng po.quantity nhất quán
               po.quantity AS quantity,
               COALESCE(t.status, po.status) AS status,
               -- Sản lượng CHỈ tính khi LSX đã/đang sản xuất: Hoàn thành, Đang sản xuất,
               -- Chờ nguyên vật liệu, Tạm dừng. KHÔNG tính khi LSX Chờ duyệt / Đã lên kế hoạch /
               -- Đã hủy, hoặc khi chính lần (task) đó đã hủy.
               CASE
                 WHEN po.status IN ('Chờ duyệt', 'Đã lên kế hoạch', 'Đã hủy') THEN 0
                 WHEN t.status = 'Đã hủy' THEN 0
                 WHEN COALESCE(t.status, po.status) = 'Hoàn thành'
                   THEN COALESCE(t.actual_qty, po.posted_qty, po.quantity)
                 ELSE COALESCE(t.actual_qty, po.posted_qty, 0)
               END AS actual_qty,
               COALESCE(t.updated_at, po.updated_at) AS updated_at,
               COALESCE(t.planned_date, po.planned_date) AS planned_date,
               po.planned_date AS po_planned_date,
               po.created_at AS po_created_at,
               COALESCE(t.stage, 'Chung') AS stage,
               COALESCE(t.shift, po.shift) AS shift,
               COALESCE(t.assigned_worker, po.assigned_worker) AS final_worker,
               t.assigned_worker_id AS final_worker_id,
               po.order_code,
               po.priority
        FROM production_orders po
        LEFT JOIN production_tasks t ON t.production_order_id = po.id
        WHERE po.is_deleted = FALSE
          AND COALESCE(t.assigned_worker, po.assigned_worker) IS NOT NULL
          AND COALESCE(t.assigned_worker, po.assigned_worker) != ''
      ),
      filtered_tasks AS (
        SELECT * FROM raw_tasks
        WHERE 1=1 ${taskWhereClause}
      ),
      worker_scrap AS (
        SELECT COALESCE(dsr.employee_id,
                 (SELECT e2.id FROM employees e2 WHERE e2.is_deleted=false AND e2.name = dsr.worker_name
                    AND (SELECT count(*) FROM employees e3 WHERE e3.is_deleted=false AND e3.name = dsr.worker_name)=1 LIMIT 1)
               ) AS emp_id,
               SUM(dsi.scrap_qty) as total_scrap
        FROM daily_scrap_records dsr
        JOIN daily_scrap_items dsi ON dsi.record_id = dsr.id
        ${scrapWhereClause}
        GROUP BY 1
      ),
      dedup_employees AS (
        SELECT id, name, factory
        FROM employees e
        WHERE ${empWhere.join(' AND ')}
      )
      SELECT
        e.name                                                                        AS worker,
        e.factory                                                                     AS team,
        COUNT(t.id)::int                                                              AS tasks_count,
        COUNT(DISTINCT t.production_order_id)::int                                    AS orders_count,
        COALESCE(SUM(t.quantity), 0)::numeric                                         AS planned_qty,
        -- S\u1ea3n l\u01b0\u1ee3ng l\u00e0m \u0111\u01b0\u1ee3c: c\u1ed9ng SL th\u1ef1c c\u1ee7a T\u1eeaNG l\u1ea7n, t\u00ednh c\u1ea3 LSX \u0111ang SX (l\u00e0m d\u1edf nhi\u1ec1u ng\u00e0y).
        -- raw_tasks.actual_qty \u0111\u00e3 x\u1eed l\u00fd: Ho\u00e0n th\u00e0nh\u2192actual|posted|k\u1ebf ho\u1ea1ch; \u0111ang l\u00e0m\u2192actual|posted|0.
        COALESCE(SUM(t.actual_qty), 0)::numeric                                        AS actual_qty,
        COALESCE(MAX(ws.total_scrap), 0)::numeric                                     AS scrap_qty,
        -- work_days: s\u1ed1 ng\u00e0y l\u00e0m vi\u1ec7c th\u1ef1c t\u1ebf (d\u00f9ng updated_at n\u1ebfu c\u00f3, fallback planned_date)
        COUNT(DISTINCT COALESCE(t.updated_at::date, t.planned_date))::int             AS work_days,
        -- work_hours: 8h m\u1ed7i ng\u00e0y l\u00e0m vi\u1ec7c th\u1ef1c t\u1ebf
        COUNT(DISTINCT COALESCE(t.updated_at::date, t.planned_date)) * 8              AS work_hours,
        COUNT(t.id) FILTER (WHERE t.status = 'Ho\u00e0n th\u00e0nh')::int                       AS done_count,
        COUNT(t.id) FILTER (WHERE t.status IN ('\u0110ang s\u1ea3n xu\u1ea5t','Ch\u1edd'))::int           AS active_count,
        COUNT(t.id) FILTER (WHERE t.status = 'D\u1eebng s\u1ea3n xu\u1ea5t')::int                   AS paused_count,
        STRING_AGG(DISTINCT t.stage, ', ' ORDER BY t.stage)                           AS stages,
        STRING_AGG(DISTINCT t.shift, ', ')
          FILTER (WHERE t.shift IS NOT NULL AND t.shift != '')                        AS shifts
      FROM dedup_employees e
      LEFT JOIN filtered_tasks t ON (t.final_worker_id = e.id OR (t.final_worker_id IS NULL AND t.final_worker = e.name))
      LEFT JOIN worker_scrap ws ON ws.emp_id = e.id
      GROUP BY e.id, e.name, e.factory
      ORDER BY actual_qty DESC, planned_qty DESC, e.name
    `, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'L\u1ed7i khi l\u1ea5y b\u00e1o c\u00e1o nh\u00e2n vi\u00ean' }); }
};


// GET /reports/employees/:worker/tasks — chi tiết lệnh + phân tích theo ngày & công đoạn
exports.employeeTasks = async (req, res) => {
  try {
    const worker = req.params.worker;
    
    // Nếu user bị gán cố định với 1 worker, và yêu cầu truy cập chi tiết worker khác thì chặn
    if (req.user && req.user.linked_worker && req.user.linked_worker !== worker) {
      return res.status(403).json({ message: 'Bạn không có quyền xem báo cáo của nhân viên khác' });
    }
    
    const { fromDate, toDate, stage, shift, team } = req.query;
    const params = [worker]; let i = 2;
    // Match task-level OR order-level assigned_worker
    // Dùng updated_at ưu tiên: để tìm task được hoàn thành trong kỳ dù planned_date có thể lệch
    const where = [`final_worker = $1`];
    if (fromDate) { where.push(`COALESCE(updated_at::date, planned_date, po_planned_date, po_created_at::date) >= $${i++}`); params.push(fromDate); }
    if (toDate)   { where.push(`COALESCE(updated_at::date, planned_date, po_planned_date, po_created_at::date) <= $${i++}`); params.push(toDate); }
    if (stage)    { where.push(`stage = $${i++}`); params.push(stage); }
    if (shift)    { where.push(`shift = $${i++}`); params.push(shift); }
    if (team)     { where.push(`final_team = $${i++}`); params.push(team); }
    const ws = where.join(' AND ');

    // Params riêng cho scrap query
    const scrapParams = [worker];
    const scrapWhere = [`dsr.worker_name = $1`];
    let si = 2;
    if (fromDate) { scrapWhere.push(`dsr.record_date >= $${si++}`); scrapParams.push(fromDate); }
    if (toDate)   { scrapWhere.push(`dsr.record_date <= $${si++}`); scrapParams.push(toDate); }

    const rawTasksCTE = `
      WITH raw_tasks AS (
        SELECT COALESCE(t.id, po.id) AS id,
               t.task_code,
               COALESCE(t.stage, 'Chung') AS stage,
               -- Kế hoạch: dùng po.quantity (SL lệnh gốc) nhất quán
               -- Đơn gấp không có kế hoạch phân công → t.quantity không đáng tin
               po.quantity AS quantity,
               -- Sản lượng CHỈ tính khi LSX đã/đang sản xuất: Hoàn thành, Đang sản xuất,
               -- Chờ nguyên vật liệu, Tạm dừng. KHÔNG tính khi LSX Chờ duyệt / Đã lên kế hoạch /
               -- Đã hủy, hoặc khi chính lần (task) đó đã hủy.
               CASE
                 WHEN po.status IN ('Chờ duyệt', 'Đã lên kế hoạch', 'Đã hủy') THEN 0
                 WHEN t.status = 'Đã hủy' THEN 0
                 WHEN COALESCE(t.status, po.status) = 'Hoàn thành'
                   THEN COALESCE(t.actual_qty, po.posted_qty, po.quantity)
                 ELSE COALESCE(t.actual_qty, po.posted_qty, 0)
               END AS actual_qty,
               COALESCE(t.scrap_qty, 0) AS scrap_qty,
               COALESCE(t.status, po.status) AS status,
               COALESCE(t.planned_date, po.planned_date) AS planned_date,
               po.planned_date AS po_planned_date,
               po.created_at AS po_created_at,
               COALESCE(t.updated_at, po.updated_at) AS updated_at,
               COALESCE(t.shift, po.shift) AS shift,
               COALESCE(t.assigned_team, po.assigned_team) AS final_team,
               COALESCE(t.assigned_worker, po.assigned_worker) AS final_worker,
               po.id AS order_id, po.order_code, po.unit, po.material_type,
               po.priority,
               so.order_code AS sales_order_code,
               p.product_name, p.product_code, c.name AS customer_name
        FROM production_orders po
        LEFT JOIN production_tasks t ON t.production_order_id = po.id
        JOIN products p ON p.id = po.product_id
        LEFT JOIN sales_orders so ON so.id = po.sales_order_id
        LEFT JOIN customers c ON c.id = po.customer_id
        WHERE po.is_deleted = FALSE
      )
    `;

    const [tasksQ, dailyQ, stagesQ, scrapDailyQ] = await Promise.all([
      db.query(`
        ${rawTasksCTE}
        SELECT *
        FROM raw_tasks
        WHERE ${ws}
        ORDER BY COALESCE(updated_at, planned_date::timestamp) DESC NULLS LAST, order_code
      `, params),
      db.query(`
        ${rawTasksCTE}
        SELECT
               COALESCE(updated_at::date, planned_date) AS planned_date,
               to_char(COALESCE(updated_at::date, planned_date), 'DD/MM') AS date_label,
               COALESCE(SUM(actual_qty),0)::numeric AS actual_qty, -- tính cả LSX đang SX
               COALESCE(SUM(quantity),0)::numeric AS planned_qty
        FROM raw_tasks
        WHERE ${ws} AND COALESCE(updated_at::date, planned_date) IS NOT NULL
        GROUP BY COALESCE(updated_at::date, planned_date)
        ORDER BY COALESCE(updated_at::date, planned_date)
      `, params),
      db.query(`
        ${rawTasksCTE}
        SELECT stage,
               COALESCE(SUM(actual_qty),0)::numeric AS actual_qty, -- tính cả LSX đang SX
               COALESCE(SUM(quantity),0)::numeric AS planned_qty,
               COUNT(*)::int AS tasks_count
        FROM raw_tasks
        WHERE ${ws}
        GROUP BY stage

        ORDER BY actual_qty DESC
      `, params),
      // Scrap query dùng params riêng — tránh phụ thuộc vào thứ tự params chính
      db.query(`
        SELECT dsr.record_date as date,
               to_char(dsr.record_date, 'DD/MM') AS date_label,
               COALESCE(SUM(dsi.scrap_qty),0)::numeric AS total_scrap
        FROM daily_scrap_records dsr
        JOIN daily_scrap_items dsi ON dsi.record_id = dsr.id
        WHERE ${scrapWhere.join(' AND ')}
        GROUP BY dsr.record_date
        ORDER BY dsr.record_date
      `, scrapParams),
    ]);
    res.json({ tasks: tasksQ.rows, daily: dailyQ.rows, stages: stagesQ.rows, scrapDaily: scrapDailyQ.rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'L\u1ed7i khi l\u1ea5y chi ti\u1ebft nh\u00e2n vi\u00ean' }); }
};

// Quy\u1ec1n xem ti\u1ec1n (doanh thu/c\u00f4ng n\u1ee3) \u2014 helper d\u00f9ng chung
const { canViewAmounts } = require('../../core/lib/money');

// GET /reports/director?period=week|month \u2014 B\u00e1o c\u00e1o t\u1ed5ng h\u1ee3p cho gi\u00e1m \u0111\u1ed1c (3 kh\u1ed1i)
exports.director = async (req, res) => {
  try {
    const period = req.query.period === 'week' ? 'week' : 'month';
    const now = new Date();
    let from;
    if (period === 'week') { const d = new Date(now); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); from = d; }
    else { from = new Date(now.getFullYear(), now.getMonth(), 1); }
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const f = ymd(from), t = ymd(now);
    const showAmt = canViewAmounts(req);

    const [salesQ, moneyQ, poCountQ, nvlQ, lowQ, workerCntQ, perfQ, agQ, custQ, billQ, salesListQ, deliveriesListQ] = await Promise.all([
      // Kh\u1ed1i 1: \u0111\u01a1n h\u00e0ng trong k\u1ef3 + gi\u00e1 tr\u1ecb + \u0111\u00e3 giao / ch\u01b0a giao (theo \u0111\u01a1n)
      db.query(`
        WITH ord AS (
          SELECT so.id,
            COALESCE((SELECT SUM(it.quantity*COALESCE(it.unit_price,0)) FROM sales_order_items it WHERE it.sales_order_id=so.id),0) AS val,
            COALESCE((SELECT SUM(di.quantity*COALESCE(soi.unit_price,0))
                      FROM delivery_note_items di
                      JOIN delivery_notes dn ON dn.id=di.delivery_note_id
                      LEFT JOIN sales_order_items soi ON soi.id=di.sales_order_item_id
                      WHERE soi.sales_order_id=so.id AND dn.is_deleted=FALSE AND dn.status NOT IN ('B\u1ea3n nh\u00e1p','\u0110\u00e3 h\u1ee7y')),0) AS delivered_val
          FROM sales_orders so
          WHERE so.is_deleted=FALSE AND so.status<>'\u0110\u00e3 h\u1ee7y' AND so.order_date BETWEEN $1 AND $2
        )
        SELECT COUNT(*)::int AS order_count,
               COALESCE(SUM(val),0)::numeric AS total_value,
               COALESCE(SUM(delivered_val),0)::numeric AS delivered_value,
               GREATEST(0, COALESCE(SUM(val),0)-COALESCE(SUM(delivered_val),0))::numeric AS undelivered_value,
               COUNT(*) FILTER (WHERE delivered_val > 0)::int AS shipped_count,
               COUNT(*) FILTER (WHERE val > 0 AND delivered_val >= val - 1e-6)::int AS fully_count
        FROM ord`, [f, t]),
      // Kh\u1ed1i 1: \u0111\u00e3 thu / c\u00f4ng n\u1ee3 (theo phi\u1ebfu giao trong k\u1ef3)
      db.query(`
        SELECT COALESCE(SUM(paid_amount),0)::numeric AS collected,
               COALESCE(SUM(total_amount-paid_amount),0)::numeric AS debt,
               COALESCE(SUM(total_amount),0)::numeric AS invoiced
        FROM delivery_notes
        WHERE is_deleted=FALSE AND status<>'\u0110\u00e3 h\u1ee7y' AND delivery_date BETWEEN $1 AND $2`, [f, t]),
      // Kh\u1ed1i 2: s\u1ed1 y\u00eau c\u1ea7u s\u1ea3n xu\u1ea5t (LSX t\u1ea1o trong k\u1ef3)
      db.query(`SELECT COUNT(*)::int AS n FROM production_orders WHERE is_deleted=FALSE AND created_at::date BETWEEN $1 AND $2`, [f, t]),
      // Kh\u1ed1i 2: \u0111\u1ee7 / thi\u1ebfu NVL tr\u00ean c\u00e1c LSX c\u00f2n c\u1ea7n NVL (ch\u01b0a ho\u00e0n th\u00e0nh/h\u1ee7y)
      db.query(`
        WITH nvl AS (
          SELECT s.product_id, SUM(s.quantity) AS oh
          FROM inventory_stock s JOIN locations l ON l.id=s.location_id JOIN warehouses w ON w.id=l.warehouse_id
          WHERE w.warehouse_type='NVL' GROUP BY s.product_id
        ),
        po_period AS (
          SELECT id FROM production_orders
          WHERE is_deleted=FALSE AND status NOT IN ('Ho\u00e0n th\u00e0nh','\u0110\u00e3 h\u1ee7y') AND created_at::date BETWEEN $1 AND $2
        ),
        short AS (
          SELECT DISTINCT pom.production_order_id
          FROM production_order_materials pom
          JOIN po_period pp ON pp.id=pom.production_order_id
          LEFT JOIN nvl ON nvl.product_id=pom.material_id
          WHERE COALESCE(pom.qty,0) > COALESCE(nvl.oh,0)
        )
        SELECT (SELECT COUNT(*)::int FROM po_period) AS active_po,
               (SELECT COUNT(*)::int FROM short) AS short_po`, [f, t]),
      // Kh\u1ed1i 2: NVL (kg) t\u1ed3n d\u01b0\u1edbi 1 t\u1ea5n
      db.query(`
        SELECT p.product_name AS name, SUM(s.quantity)::numeric AS on_hand, MAX(s.unit) AS unit
        FROM inventory_stock s
        JOIN products p ON p.id=s.product_id
        JOIN locations l ON l.id=s.location_id JOIN warehouses w ON w.id=l.warehouse_id
        WHERE w.warehouse_type='NVL' AND upper(COALESCE(s.unit,''))='KG'
        GROUP BY p.id, p.product_name
        HAVING SUM(s.quantity) < 1000
        ORDER BY SUM(s.quantity) ASC`),
      // Kh\u1ed1i 3: s\u1ed1 c\u00f4ng nh\u00e2n
      db.query(`SELECT COUNT(*)::int AS n FROM employees WHERE is_deleted=FALSE`),
      // Kh\u1ed1i 3: s\u1ea3n l\u01b0\u1ee3ng & gi\u1edd c\u00f4ng theo nh\u00e2n vi\u00ean (trong k\u1ef3)
      db.query(`
        WITH raw_tasks AS (
          SELECT po.id AS production_order_id,
            CASE
              WHEN po.status IN ('Ch\u1edd duy\u1ec7t','\u0110\u00e3 l\u00ean k\u1ebf ho\u1ea1ch','\u0110\u00e3 h\u1ee7y') THEN 0
              WHEN t.status='\u0110\u00e3 h\u1ee7y' THEN 0
              WHEN COALESCE(t.status,po.status)='Ho\u00e0n th\u00e0nh' THEN COALESCE(t.actual_qty,po.posted_qty,po.quantity)
              ELSE COALESCE(t.actual_qty,po.posted_qty,0)
            END AS actual_qty,
            COALESCE(t.updated_at,po.updated_at) AS updated_at,
            COALESCE(t.planned_date,po.planned_date) AS planned_date,
            COALESCE(t.assigned_worker,po.assigned_worker) AS final_worker,
            t.assigned_worker_id AS final_worker_id
          FROM production_orders po
          LEFT JOIN production_tasks t ON t.production_order_id=po.id
          WHERE po.is_deleted=FALSE
            AND COALESCE(t.assigned_worker,po.assigned_worker) IS NOT NULL
            AND COALESCE(t.assigned_worker,po.assigned_worker)<>''
            AND COALESCE(t.updated_at::date,t.planned_date,po.planned_date,po.created_at::date) BETWEEN $1 AND $2
        ),
        emp AS (SELECT id,name FROM employees WHERE is_deleted=FALSE)
        SELECT e.name AS worker,
               COALESCE(SUM(t.actual_qty),0)::numeric AS actual_qty,
               (COUNT(DISTINCT COALESCE(t.updated_at::date,t.planned_date))*8)::int AS work_hours
        FROM emp e
        LEFT JOIN raw_tasks t ON (t.final_worker_id=e.id OR (t.final_worker_id IS NULL AND t.final_worker=e.name))
        GROUP BY e.id, e.name`, [f, t]),
      // Công nợ phải thu (as-of-now, loại Bản nháp/Đã hủy) — tổng + quá hạn + tuổi nợ
      db.query(`
        WITH openn AS (
          SELECT dn.customer_id, (dn.total_amount - dn.paid_amount) AS due, (CURRENT_DATE - dn.delivery_date) AS age
          FROM delivery_notes dn
          WHERE dn.is_deleted=FALSE AND dn.status NOT IN ('Bản nháp','Đã hủy')
            AND (dn.total_amount - dn.paid_amount) > 0 AND dn.delivery_date IS NOT NULL
        )
        SELECT COALESCE(SUM(due),0)::numeric AS total_debt,
               COUNT(DISTINCT customer_id)::int AS customer_count,
               COALESCE(SUM(due) FILTER (WHERE age>30),0)::numeric AS overdue_amount,
               COALESCE(SUM(due) FILTER (WHERE age<=30),0)::numeric AS intime_amount,
               COUNT(*) FILTER (WHERE age>30)::int AS overdue_count,
               COALESCE(SUM(due) FILTER (WHERE age<180),0)::numeric AS b_lt6m,
               COALESCE(SUM(due) FILTER (WHERE age>=180 AND age<365),0)::numeric AS b_6_12,
               COALESCE(SUM(due) FILTER (WHERE age>=365 AND age<730),0)::numeric AS b_1_2,
               COALESCE(SUM(due) FILTER (WHERE age>=730),0)::numeric AS b_gt2
        FROM openn`),
      // Công nợ theo khách hàng (tuổi nợ) — top 8
      db.query(`
        WITH openn AS (
          SELECT c.name AS customer_name, (dn.total_amount - dn.paid_amount) AS due, (CURRENT_DATE - dn.delivery_date) AS age
          FROM delivery_notes dn LEFT JOIN customers c ON c.id=dn.customer_id
          WHERE dn.is_deleted=FALSE AND dn.status NOT IN ('Bản nháp','Đã hủy')
            AND (dn.total_amount - dn.paid_amount) > 0 AND dn.delivery_date IS NOT NULL
        )
        SELECT COALESCE(customer_name,'(không rõ)') AS name,
               COALESCE(SUM(due),0)::numeric AS debt,
               COALESCE(SUM(due) FILTER (WHERE age<180),0)::numeric AS b_lt6m,
               COALESCE(SUM(due) FILTER (WHERE age>=180 AND age<365),0)::numeric AS b_6_12,
               COALESCE(SUM(due) FILTER (WHERE age>=365 AND age<730),0)::numeric AS b_1_2,
               COALESCE(SUM(due) FILTER (WHERE age>=730),0)::numeric AS b_gt2
        FROM openn GROUP BY customer_name ORDER BY debt DESC LIMIT 8`),
      // Tổng đã xuất hóa đơn & đã thu (as-of-now, loại Bản nháp/Đã hủy)
      db.query(`
        SELECT COALESCE(SUM(total_amount),0)::numeric AS billed, COALESCE(SUM(paid_amount),0)::numeric AS paid
        FROM delivery_notes WHERE is_deleted=FALSE AND status NOT IN ('Bản nháp','Đã hủy')`),
      // Danh sách đơn hàng trong kỳ
      db.query(`
        SELECT so.id, so.order_code, so.order_date, c.name AS customer_name,
          COALESCE((SELECT SUM(it.quantity*COALESCE(it.unit_price,0)) FROM sales_order_items it WHERE it.sales_order_id=so.id),0) AS val,
          COALESCE((SELECT SUM(di.quantity*COALESCE(soi.unit_price,0))
                    FROM delivery_note_items di
                    JOIN delivery_notes dn ON dn.id=di.delivery_note_id
                    LEFT JOIN sales_order_items soi ON soi.id=di.sales_order_item_id
                    WHERE soi.sales_order_id=so.id AND dn.is_deleted=FALSE AND dn.status NOT IN ('Bản nháp','Đã hủy')),0) AS delivered_val
        FROM sales_orders so
        LEFT JOIN customers c ON c.id=so.customer_id
        WHERE so.is_deleted=FALSE AND so.status<>'Đã hủy' AND so.order_date BETWEEN $1 AND $2
        ORDER BY so.order_date DESC
      `, [f, t]),
      // Danh sách phiếu giao (đã xuất/thu tiền) trong kỳ
      db.query(`
        SELECT dn.id, dn.note_code, dn.delivery_date, c.name AS customer_name,
               dn.total_amount, dn.paid_amount
        FROM delivery_notes dn
        LEFT JOIN customers c ON c.id=dn.customer_id
        WHERE dn.is_deleted=FALSE AND dn.status<>'Đã hủy' AND dn.delivery_date BETWEEN $1 AND $2
        ORDER BY dn.delivery_date DESC
      `, [f, t]),
    ]);

    const s = salesQ.rows[0], m = moneyQ.rows[0], nv = nvlQ.rows[0];
    const num = (x) => Math.round(Number(x) || 0);

    // Hi\u1ec7u su\u1ea5t: n\u0103ng su\u1ea5t/gi\u1edd = s\u1ea3n l\u01b0\u1ee3ng / gi\u1edd c\u00f4ng (gi\u1edd c\u00f4ng = s\u1ed1 ng\u00e0y l\u00e0m \u00d7 8)
    const perf = perfQ.rows
      .map((r) => ({ worker: r.worker, actual: Number(r.actual_qty) || 0, hours: Number(r.work_hours) || 0 }))
      .filter((r) => r.actual > 0);
    const totActual = perf.reduce((a, r) => a + r.actual, 0);
    const totHours = perf.reduce((a, r) => a + r.hours, 0);
    const top = perf
      .map((r) => ({ worker: r.worker, per_hour: r.hours > 0 ? Math.round(r.actual / r.hours) : 0, output: Math.round(r.actual) }))
      .sort((a, b) => b.per_hour - a.per_hour || b.output - a.output)
      .slice(0, 5);

    res.json({
      period, from: f, to: t, can_view_amounts: showAmt,
      sales: {
        order_count: s.order_count,
        shipped_count: s.shipped_count,
        fully_count: s.fully_count,
        total_value: showAmt ? num(s.total_value) : null,
        collected: showAmt ? num(m.collected) : null,
        debt: showAmt ? num(m.debt) : null,
        delivered_value: showAmt ? num(s.delivered_value) : null,
        undelivered_value: showAmt ? num(s.undelivered_value) : null,
        orders: showAmt ? salesListQ.rows.map((r) => ({
          id: r.id, order_code: r.order_code, date: r.order_date, customer: r.customer_name,
          total: num(r.val), delivered: num(r.delivered_val), undelivered: Math.max(0, num(r.val) - num(r.delivered_val))
        })) : [],
        deliveries: showAmt ? deliveriesListQ.rows.map((r) => ({
          id: r.id, code: r.note_code, date: r.delivery_date, customer: r.customer_name,
          total: num(r.total_amount), paid: num(r.paid_amount)
        })) : [],
      },
      production: {
        request_count: poCountQ.rows[0].n,
        active_count: nv.active_po,
        short_count: nv.short_po,
        enough_count: Math.max(0, nv.active_po - nv.short_po),
        low_materials: lowQ.rows.map((r) => ({ name: r.name, on_hand: Math.round(Number(r.on_hand) || 0), unit: r.unit || 'KG' })),
      },
      workforce: {
        worker_count: workerCntQ.rows[0].n,
        avg_per_hour: totHours > 0 ? Math.round(totActual / totHours) : 0,
        top,
      },
      // Công nợ phải thu (as-of-now) — cho tab Kinh doanh; chỉ trả khi có quyền xem tiền
      receivables: showAmt ? (() => {
        const a = agQ.rows[0];
        return {
          overdue_days: 30,
          total_debt: num(a.total_debt),
          billed_total: num(billQ.rows[0].billed),
          collected_total: num(billQ.rows[0].paid),
          customer_count: a.customer_count,
          overdue_amount: num(a.overdue_amount),
          intime_amount: num(a.intime_amount),
          overdue_count: a.overdue_count,
          buckets: { lt6m: num(a.b_lt6m), m6_12: num(a.b_6_12), y1_2: num(a.b_1_2), gt2: num(a.b_gt2) },
          by_customer: custQ.rows.map((r) => ({
            name: r.name, debt: num(r.debt),
            lt6m: num(r.b_lt6m), m6_12: num(r.b_6_12), y1_2: num(r.b_1_2), gt2: num(r.b_gt2),
          })),
        };
      })() : null,
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'L\u1ed7i khi l\u1ea5y b\u00e1o c\u00e1o gi\u00e1m \u0111\u1ed1c' }); }
};

