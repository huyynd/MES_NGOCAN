// backend/controllers/workScheduleController.js — Lịch làm việc (nhân viên × ngày → ca)
const db = require('../../core/db');
const { dbInputMessage } = require('../../core/lib/validate');

// GET /api/work-schedules?from=&to=
exports.list = async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = []; const params = []; let i = 1;
    if (from) { where.push(`ws.work_date >= $${i++}`); params.push(from); }
    if (to) { where.push(`ws.work_date <= $${i++}`); params.push(to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await db.query(`
      SELECT ws.id, ws.employee_id, ws.work_date, ws.shift_id, ws.note, ws.check_in_at, ws.check_out_at,
             e.name AS employee_name, e.employee_code, e.factory, s.name AS shift_name
      FROM work_schedules ws
      JOIN employees e ON e.id = ws.employee_id
      LEFT JOIN shifts s ON s.id = ws.shift_id
      ${whereSql} ORDER BY e.factory, e.name, ws.work_date`, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy lịch làm việc' }); }
};

// PUT /api/work-schedules — gán/đổi/xóa ca cho 1 ô (nhân viên + ngày)
exports.upsert = async (req, res) => {
  try {
    const { employee_id, work_date, shift_id, note } = req.body;
    if (!employee_id || !work_date) return res.status(400).json({ message: 'Thiếu nhân viên hoặc ngày' });
    
    // Kiểm tra ràng buộc thời gian & chấm công
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const wDate = new Date(work_date);
    wDate.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today - wDate) / (1000 * 60 * 60 * 24));
    
    // Nếu quá 3 ngày trong quá khứ -> chặn
    if (diffDays > 3) {
      return res.status(400).json({ message: 'Không thể thay đổi ca trước ngày hôm nay quá 3 ngày' });
    }

    // Kiểm tra xem đã có dữ liệu chấm công chưa
    const { rows: existing } = await db.query(
      `SELECT check_in_at, check_out_at FROM work_schedules WHERE employee_id = $1 AND work_date = $2`, 
      [employee_id, work_date]
    );
    if (existing.length && (existing[0].check_in_at || existing[0].check_out_at)) {
      return res.status(400).json({ message: 'Không thể thay đổi ca đã có dữ liệu chấm công' });
    }

    if (!shift_id) {
      await db.query(`DELETE FROM work_schedules WHERE employee_id = $1 AND work_date = $2`, [employee_id, work_date]);
      return res.json({ message: 'Đã xóa ca' });
    }
    const { rows } = await db.query(`
      INSERT INTO work_schedules (employee_id, work_date, shift_id, note)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (employee_id, work_date)
      DO UPDATE SET shift_id = EXCLUDED.shift_id, note = EXCLUDED.note, updated_at = now()
      RETURNING *`, [employee_id, work_date, shift_id, note || null]);
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lưu lịch làm việc' }); }
};

// PUT /api/work-schedules/bulk — cập nhật nhiều ca làm việc cùng lúc
exports.bulkUpsert = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const data = req.body;
    if (!Array.isArray(data)) return res.status(400).json({ message: 'Dữ liệu không hợp lệ' });

    await client.query('BEGIN');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const item of data) {
      const { employee_id, work_date, shift_id, note } = item;
      if (!employee_id || !work_date) throw new Error('Thiếu nhân viên hoặc ngày');

      const wDate = new Date(work_date);
      wDate.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((today - wDate) / (1000 * 60 * 60 * 24));
      
      if (diffDays > 3) {
        throw new Error(`Không thể thay đổi ca ngày ${work_date} (quá 3 ngày)`);
      }

      const { rows: existing } = await client.query(
        `SELECT check_in_at, check_out_at FROM work_schedules WHERE employee_id = $1 AND work_date = $2`, 
        [employee_id, work_date]
      );
      if (existing.length && (existing[0].check_in_at || existing[0].check_out_at)) {
        throw new Error(`Không thể thay đổi ca ngày ${work_date} vì đã có dữ liệu chấm công`);
      }

      if (!shift_id) {
        await client.query(`DELETE FROM work_schedules WHERE employee_id = $1 AND work_date = $2`, [employee_id, work_date]);
      } else {
        await client.query(`
          INSERT INTO work_schedules (employee_id, work_date, shift_id, note)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (employee_id, work_date)
          DO UPDATE SET shift_id = EXCLUDED.shift_id, note = EXCLUDED.note, updated_at = now()`, 
          [employee_id, work_date, shift_id, note || null]);
      }
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Đã lưu lịch làm việc thành công' });
  } catch (err) { 
    await client.query('ROLLBACK');
    console.error(err); 
    res.status(400).json({ message: dbInputMessage(err, 'Lỗi khi lưu lịch làm việc') });
  } finally {
    client.release();
  }
};
