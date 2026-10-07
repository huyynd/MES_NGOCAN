const db = require('../../core/db');
const { applyStock } = require('../../core/lib/stock');

// GET /api/scrap/workers — lấy toàn bộ nhân viên đang hoạt động
exports.getWorkers = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, employee_code, name
      FROM employees
      WHERE is_deleted = FALSE
      ORDER BY name
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách công nhân' });
  }
};

// GET /api/scrap/daily-wos?worker_name=...&date=...
// Trả về lệnh SX hoàn thành trong ngày ghi nhận.
exports.getDailyWos = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const worker_name = req.query.worker_name;
    if (!worker_name) return res.status(400).json({ message: 'Thiếu worker_name' });

    // Lấy các lệnh SX liên quan đến nhân viên trong ngày ghi nhận (bao gồm đang sản xuất hoặc đã cập nhật trong ngày)
    const { rows } = await db.query(`
      SELECT 
        po.id as order_id,
        po.order_code,
        po.product_id,
        p.product_name,
        p.product_code,
        p.unit,
        SUM(pt.actual_qty) as total_qty,
        MAX(pt.updated_at) as last_completed_at,
        MAX(pt.updated_at)::date as completed_date
      FROM production_tasks pt
      JOIN production_orders po ON pt.production_order_id = po.id
      JOIN products p ON po.product_id = p.id
      WHERE pt.assigned_worker = $1
        AND pt.status != 'Đã hủy'
        AND po.is_deleted = FALSE
        AND (
          pt.status IN ('Chờ', 'Đang sản xuất', 'Tạm dừng', 'Chờ nguyên vật liệu')
          OR pt.updated_at::date = $2::date
        )
      GROUP BY po.id, po.order_code, po.product_id, p.product_name, p.product_code, p.unit
      ORDER BY last_completed_at DESC
    `, [worker_name, date]);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách Lệnh SX' });
  }
};

// GET /api/scrap/records?worker_name=...&date=...
exports.getRecords = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const worker_name = req.query.worker_name;
    if (!worker_name) return res.status(400).json({ message: 'Thiếu worker_name' });

    const { rows } = await db.query(`
      SELECT * FROM daily_scrap_records 
      WHERE worker_name = $1 AND record_date = $2
    `, [worker_name, date]);

    if (!rows.length) return res.json(null);
    const record = rows[0];

    const items = await db.query(`
      SELECT i.*, p.product_name, p.product_code, p.unit
      FROM daily_scrap_items i
      JOIN products p ON i.product_id = p.id
      WHERE i.record_id = $1
    `, [record.id]);
    
    record.items = items.rows;
    res.json(record);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy dữ liệu phế phẩm' });
  }
};

// POST /api/scrap/records
exports.saveRecords = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { worker_name, record_date, note, employee_id, scrap_qty } = req.body;
    if (!worker_name || !record_date) {
      return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }

    // Đảm bảo cột employee_id và recorder_name tồn tại để không gây lỗi
    await db.pool.query(`ALTER TABLE daily_scrap_records ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id)`);
    await db.pool.query(`ALTER TABLE daily_scrap_records ADD COLUMN IF NOT EXISTS recorder_name character varying`);

    await client.query('BEGIN');

    // 1. Get Kho Phế Phẩm and its default location
    const wRes = await client.query(`SELECT id FROM warehouses WHERE warehouse_type = 'Phế liệu' LIMIT 1`);
    if (!wRes.rows.length) throw new Error("Chưa có Kho Phế Phẩm trong hệ thống");
    const scrapWarehouseId = wRes.rows[0].id;
    const lRes = await client.query(`SELECT id FROM locations WHERE warehouse_id = $1 LIMIT 1`, [scrapWarehouseId]);
    const scrapLocationId = lRes.rows.length ? lRes.rows[0].id : null;

    // 2. Get SP-PHE product
    const pRes = await client.query(`SELECT id, unit FROM products WHERE product_code = 'SP-PHE'`);
    if (!pRes.rows.length) throw new Error("Không tìm thấy sản phẩm Phế phẩm (SP-PHE) trong hệ thống");
    const pId = pRes.rows[0].id;
    const unit = pRes.rows[0].unit || 'kg';

    // 3. Upsert record
    const rRes = await client.query(`
      INSERT INTO daily_scrap_records (worker_name, record_date, note, employee_id, recorder_name, updated_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (worker_name, record_date)
      DO UPDATE SET note = EXCLUDED.note, employee_id = COALESCE(EXCLUDED.employee_id, daily_scrap_records.employee_id), recorder_name = EXCLUDED.recorder_name, updated_at = now()
      RETURNING id
    `, [worker_name, record_date, note || null, employee_id || null, req.body.recorder_name || worker_name]);
    const recordId = rRes.rows[0].id;

    // 4. Process item (generic scrap)
    const oldItem = await client.query(`SELECT scrap_qty FROM daily_scrap_items WHERE record_id = $1 AND product_id = $2`, [recordId, pId]);
    const oldQty = oldItem.rows.length ? Number(oldItem.rows[0].scrap_qty) : 0;
    const newQty = Number(scrap_qty) || 0;
    const diff = newQty - oldQty;

    await client.query(`
      INSERT INTO daily_scrap_items (record_id, product_id, finished_qty, scrap_qty)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (record_id, product_id)
      DO UPDATE SET scrap_qty = EXCLUDED.scrap_qty
    `, [recordId, pId, 0, newQty]);

    if (diff !== 0 && scrapLocationId) {
      // Qua applyStock (sổ cái khớp tồn, không đi vòng qua inventory_stock)
      await applyStock(client, {
        product_id: pId, location_id: scrapLocationId, delta: diff, unit,
        specs: {}, lot_code: '', clampZero: false,
        trx_type: diff > 0 ? 'Nhập' : 'Xuất',
        ref_code: 'Ghi phế ' + record_date, note: 'Ghi nhận phế từ CN: ' + worker_name,
      });
    }

    await client.query('COMMIT');
    res.json({ message: 'Đã lưu ghi nhận phế phẩm chung', recordId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: err.message || 'Lỗi khi lưu dữ liệu phế phẩm' });
  } finally {
    client.release();
  }
};

// GET /api/scrap/statistics?worker_name=...&end_date=...
exports.getStats = async (req, res) => {
  try {
    const end_date = req.query.end_date || new Date().toISOString().slice(0, 10);
    const worker_name = req.query.worker_name;
    if (!worker_name) return res.status(400).json({ message: 'Thiếu worker_name' });

    const statsQuery = await db.query(`
      WITH date_series AS (
        SELECT generate_series($1::date - interval '6 days', $1::date, '1 day')::date AS d
      ),
      wo_stats AS (
        SELECT updated_at::date as d, COUNT(DISTINCT production_order_id) as total_wos, SUM(actual_qty) as total_finished
        FROM production_tasks 
        WHERE status = 'Hoàn thành' 
          AND assigned_worker = $2
          AND updated_at::date >= $1::date - interval '6 days'
        GROUP BY updated_at::date
      ),
      scrap_stats AS (
        SELECT dsr.record_date as d, SUM(dsi.scrap_qty) as total_scrap
        FROM daily_scrap_records dsr
        JOIN daily_scrap_items dsi ON dsi.record_id = dsr.id
        WHERE dsr.worker_name = $2
          AND dsr.record_date >= $1::date - interval '6 days'
        GROUP BY dsr.record_date
      )
      SELECT ds.d as date, 
             COALESCE(ws.total_wos, 0) as total_wos,
             COALESCE(ws.total_finished, 0) as total_finished,
             COALESCE(ss.total_scrap, 0) as total_scrap
      FROM date_series ds
      LEFT JOIN wo_stats ws ON ws.d = ds.d
      LEFT JOIN scrap_stats ss ON ss.d = ds.d
      ORDER BY ds.d ASC
    `, [end_date, worker_name]);

    // Tổng hợp toàn bộ cửa sổ 7 ngày tách biệt để KPI summary luôn đúng
    // dù task hoàn thành và ngày cân phế lệch 1-2 ngày
    const totalsQuery = await db.query(`
      SELECT
        COALESCE(SUM(pt.actual_qty), 0)::numeric AS total_finished,
        COALESCE((
          SELECT SUM(dsi.scrap_qty)
          FROM daily_scrap_records dsr
          JOIN daily_scrap_items dsi ON dsi.record_id = dsr.id
          WHERE dsr.worker_name = $2
            AND dsr.record_date BETWEEN $1::date - interval '6 days' AND $1::date
        ), 0)::numeric AS total_scrap
      FROM production_tasks pt
      WHERE pt.assigned_worker = $2
        AND pt.status = 'Hoàn thành'
        AND pt.updated_at::date BETWEEN $1::date - interval '6 days' AND $1::date
    `, [end_date, worker_name]);

    res.json({ rows: statsQuery.rows, totals: totalsQuery.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy thống kê' });
  }
};


// GET /api/scrap/daily-details?worker_name=...&date=...
exports.getDailyDetails = async (req, res) => {
  try {
    const date = req.query.date;
    const worker_name = req.query.worker_name;
    if (!worker_name || !date) return res.status(400).json({ message: 'Thiếu thông tin' });

    // Fetch tasks completed by worker on this date
    const tasksQuery = await db.query(`
      SELECT 
        pt.id as task_id,
        pt.stage as step_name,
        pt.actual_qty,
        po.id as order_id,
        po.order_code,
        p.product_code,
        p.product_name,
        p.unit,
        p.id as product_id
      FROM production_tasks pt
      JOIN production_orders po ON pt.production_order_id = po.id
      JOIN products p ON po.product_id = p.id
      WHERE pt.assigned_worker = $1
        AND pt.status = 'Hoàn thành'
        AND pt.updated_at::date = $2
      ORDER BY po.order_code ASC, pt.stage ASC
    `, [worker_name, date]);

    // Fetch scrap recorded for this worker on this date
    const scrapQuery = await db.query(`
      SELECT dsi.product_id, dsi.scrap_qty
      FROM daily_scrap_records dsr
      JOIN daily_scrap_items dsi ON dsi.record_id = dsr.id
      WHERE dsr.worker_name = $1 AND dsr.record_date = $2
    `, [worker_name, date]);

    // Map scrap to products
    const scrapMap = {};
    scrapQuery.rows.forEach(r => {
      scrapMap[r.product_id] = Number(r.scrap_qty);
    });

    const tasks = tasksQuery.rows.map(t => ({
      ...t,
      // Since scrap is generic, product_scrap_qty no longer applies per task.
      product_scrap_qty: 0
    }));

    res.json(tasks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy chi tiết ngày' });
  }
};

// GET /api/scrap/all-records
exports.getAllRecords = async (req, res) => {
  try {
    // Đảm bảo cột employee_id và recorder_name tồn tại
    await db.query(`ALTER TABLE daily_scrap_records ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id)`);
    await db.query(`ALTER TABLE daily_scrap_records ADD COLUMN IF NOT EXISTS recorder_name character varying`);
    
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { rows } = await db.query(`
      SELECT 
        dsr.id, dsr.worker_name, dsr.record_date, dsr.note, dsr.updated_at, dsr.recorder_name,
        e.employee_code, e.name as employee_name,
        COALESCE(SUM(dsi.scrap_qty), 0)::numeric as total_scrap
      FROM daily_scrap_records dsr
      LEFT JOIN employees e ON dsr.employee_id = e.id
      LEFT JOIN daily_scrap_items dsi ON dsi.record_id = dsr.id
      WHERE dsr.record_date = $1
      GROUP BY dsr.id, dsr.worker_name, dsr.record_date, dsr.note, dsr.updated_at, dsr.recorder_name, e.employee_code, e.name
      ORDER BY dsr.updated_at DESC
    `, [date]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách phiếu ghi nhận' });
  }
};
