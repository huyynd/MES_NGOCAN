// backend/controllers/processController.js — Quy trình công nghệ + các bước
const db = require('../../core/db');
const { guardDelete } = require('../../core/lib/deleteGuard');
const { upUnit } = require('../../core/lib/units');
const { syncLinkedBom } = require('../../core/lib/bomSync');
const { clientMessage } = require('../../core/lib/validate');

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

exports.list = async (req, res) => {
  try {
    const where = ['pr.is_deleted = FALSE']; const params = []; let i = 1;
    const { q, product_id } = req.query;
    if (product_id) { where.push(`pr.product_id = $${i++}`); params.push(product_id); }
    if (q) { where.push(`(pr.process_code ILIKE $${i} OR pr.name ILIKE $${i})`); params.push(`%${q}%`); i++; }
    const { rows } = await db.query(`
      SELECT pr.*, p.product_name,
             (SELECT COUNT(*)::int FROM process_steps s WHERE s.process_id = pr.id) AS step_count
      FROM tech_processes pr LEFT JOIN products p ON p.id = pr.product_id
      WHERE ${where.join(' AND ')} ORDER BY pr.created_at DESC`, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy quy trình' }); }
};

exports.getById = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT pr.*, p.product_name,
             (SELECT b.id FROM boms b WHERE b.process_id = pr.id AND b.is_deleted = FALSE LIMIT 1) AS linked_bom_id
      FROM tech_processes pr LEFT JOIN products p ON p.id = pr.product_id
      WHERE pr.id = $1 AND pr.is_deleted = FALSE`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy quy trình' });
    const steps = await db.query(`
      SELECT s.*, pout.product_name AS output_name, m.name AS machine_name,
             (SELECT jsonb_agg(jsonb_build_object('id', m2.id, 'name', m2.name, 'factory', m2.factory, 'machine_type', m2.machine_type)) FROM machines m2 WHERE m2.id::text IN (SELECT jsonb_array_elements_text(COALESCE(s.machine_ids, '[]'::jsonb)))) AS machines_details
      FROM process_steps s
      LEFT JOIN products pout ON pout.id = s.output_product_id
      LEFT JOIN machines m ON m.id = s.machine_id
      WHERE s.process_id = $1 ORDER BY s.seq`, [req.params.id]);
    res.json({ ...rows[0], steps: steps.rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết quy trình' }); }
};

async function saveSteps(client, processId, steps) {
  await client.query('DELETE FROM process_steps WHERE process_id = $1', [processId]);
  let n = 1;
  for (const s of (Array.isArray(steps) ? steps : []).filter((x) => x && x.name)) {
    // NVL đầu vào: [{material_id, quantity, unit}]
    const inputs = Array.isArray(s.inputs)
      ? s.inputs.filter((x) => x && x.material_id).map((x) => ({ material_id: x.material_id, quantity: numOrNull(x.quantity), unit: upUnit(x.unit) }))
      : (Array.isArray(s.input_product_ids) ? s.input_product_ids.filter(Boolean).map((id) => ({ material_id: id, quantity: null, unit: null })) : []);
    const ids = inputs.map((x) => x.material_id);
    await client.query(`
      INSERT INTO process_steps
        (process_id, seq, name, workshop, machine_id, machine_ids, duration_minutes, inputs, input_product_ids, input_product_id,
         output_product_id, output_quantity, output_unit, yield_percent, scrap_percent, note)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)`,
      [processId, n++, s.name, s.workshop || null, s.machine_id || null, JSON.stringify(s.machine_ids || (s.machine_id ? [s.machine_id] : [])),
       numOrNull(s.duration_minutes), JSON.stringify(inputs), JSON.stringify(ids), ids[0] || null,
       s.output_product_id || null, numOrNull(s.output_quantity), upUnit(s.output_unit),
       numOrNull(s.yield_percent), numOrNull(s.scrap_percent), s.note || null]);
  }
}

/**
 * Gắn 1 BOM với quy trình này (chọn tay). Đặt boms.process_id, gỡ BOM khác đang gắn (nếu có).
 *  bomId rỗng → gỡ liên kết.
 */
async function linkBom(client, processId, bomId) {
  if (bomId) {
    await client.query(`UPDATE boms SET process_id = NULL WHERE process_id = $1 AND id <> $2`, [processId, bomId]);
    await client.query(`UPDATE boms SET process_id = $1, updated_at = now() WHERE id = $2 AND is_deleted = FALSE`, [processId, bomId]);
  } else {
    await client.query(`UPDATE boms SET process_id = NULL WHERE process_id = $1`, [processId]);
  }
}

exports.create = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    if (!b.name) return res.status(400).json({ message: 'Thiếu tên quy trình' });
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tech_processes (name, product_id, status, note) VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.name, b.product_id || null, b.status || 'Hoạt động', b.note || null]);
    await saveSteps(client, rows[0].id, b.steps);
    if (b.linked_bom_id !== undefined) await linkBom(client, rows[0].id, b.linked_bom_id || null);
    await syncLinkedBom(client, rows[0].id);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: clientMessage(err, 'Lỗi khi tạo quy trình') }); }
  finally { client.release(); }
};

exports.update = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    await client.query('BEGIN');
    const fields = ['name', 'product_id', 'status', 'note'];
    const cols = [], vals = []; let i = 1;
    for (const f of fields) if (b[f] !== undefined) { cols.push(`${f} = $${i++}`); vals.push(b[f] === '' ? null : b[f]); }
    if (cols.length) {
      const r = await client.query(`UPDATE tech_processes SET ${cols.join(', ')} WHERE id = $${i} AND is_deleted = FALSE RETURNING id`, [...vals, req.params.id]);
      if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy quy trình' }); }
    }
    if (b.steps !== undefined) await saveSteps(client, req.params.id, b.steps);
    if (b.linked_bom_id !== undefined) await linkBom(client, req.params.id, b.linked_bom_id || null);
    await syncLinkedBom(client, req.params.id);
    await client.query('COMMIT');
    res.json({ message: 'Đã cập nhật quy trình' });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: clientMessage(err, 'Lỗi khi cập nhật') }); }
  finally { client.release(); }
};

exports.remove = async (req, res) => {
  try {
    const g = await guardDelete('tech_processes', req.params.id, {
      blocked: ['Hoạt động'],
      message: 'Không thể xóa quy trình đang "Hoạt động" — có thể đang dùng để sinh lệnh sản xuất. Vui lòng chuyển sang "Không hoạt động" trước, rồi mới xóa.',
    });
    if (g.notFound) return res.status(404).json({ message: 'Không tìm thấy quy trình' });
    if (g.blocked) return res.status(400).json({ message: g.message });

    const { rowCount } = await db.query(`UPDATE tech_processes SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy quy trình' });
    // Gỡ liên kết ở BOM (không xóa BOM — BOM về lại chế độ nhập tay)
    await db.query(`UPDATE boms SET process_id = NULL WHERE process_id = $1`, [req.params.id]);
    res.json({ message: 'Đã xóa quy trình' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa' }); }
};
