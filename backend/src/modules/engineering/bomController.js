// backend/controllers/bomController.js — Định mức (BOM) & công thức pha màu
const db = require('../../core/db');
const { upUnit } = require('../../core/lib/units');
const { guardDelete } = require('../../core/lib/deleteGuard');
const { syncLinkedBom } = require('../../core/lib/bomSync');
const { clientMessage } = require('../../core/lib/validate');

exports.list = async (req, res) => {
  try {
    const where = ['b.is_deleted = FALSE'];
    const params = []; let i = 1;
    const { q, product_id, bom_type } = req.query;
    if (product_id) { where.push(`b.product_id = $${i++}`); params.push(product_id); }
    if (bom_type)   { where.push(`b.bom_type = $${i++}`); params.push(bom_type); }
    if (q)          { where.push(`(b.bom_code ILIKE $${i} OR b.name ILIKE $${i} OR p.product_name ILIKE $${i})`); params.push(`%${q}%`); i++; }
    const { rows } = await db.query(`
      SELECT b.*, p.product_name, p.product_code,
             (SELECT COUNT(*)::int FROM bom_lines l WHERE l.bom_id = b.id) AS line_count
      FROM boms b JOIN products p ON p.id = b.product_id
      WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC`, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy danh sách định mức' }); }
};

exports.getById = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT b.*, p.product_name, p.product_code, p.unit AS product_unit, pr.name AS process_name
      FROM boms b JOIN products p ON p.id = b.product_id
      LEFT JOIN tech_processes pr ON pr.id = b.process_id
      WHERE b.id = $1 AND b.is_deleted = FALSE`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy định mức' });
    const bom = rows[0];
    const lines = await db.query(`
      SELECT l.*, p.product_name AS material_name, p.product_code AS material_code, p.product_type AS material_type
      FROM bom_lines l JOIN products p ON p.id = l.material_id
      WHERE l.bom_id = $1 ORDER BY l.line_no, p.product_code`, [req.params.id]);
    res.json({ ...bom, lines: lines.rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết định mức' }); }
};

async function saveLines(client, bomId, lines) {
  await client.query('DELETE FROM bom_lines WHERE bom_id = $1', [bomId]);
  const valid = (Array.isArray(lines) ? lines : []).filter(l => l && l.material_id);
  let n = 1;
  for (const l of valid) {
    await client.query(
      `INSERT INTO bom_lines (bom_id, material_id, quantity, unit, ratio_percent, line_no, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [bomId, l.material_id, l.quantity || 0, upUnit(l.unit),
       l.ratio_percent === '' || l.ratio_percent == null ? null : l.ratio_percent, n++, l.note || null]);
  }
}

exports.create = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    if (!b.product_id || !b.name) return res.status(400).json({ message: 'Thiếu Sản phẩm đầu ra hoặc Tên định mức' });
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO boms (product_id, name, bom_type, output_quantity, output_unit, status, note, process_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.product_id, b.name, b.bom_type || 'Định mức NVL', b.output_quantity || 1,
       upUnit(b.output_unit), b.status || 'Hoạt động', b.note || null, b.process_id || null]);
    // Gắn quy trình → lấy NVL từ quy trình; ngược lại lưu dòng nhập tay
    if (b.process_id) await syncLinkedBom(client, b.process_id);
    else await saveLines(client, rows[0].id, b.lines);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: clientMessage(err, 'Lỗi khi tạo định mức') }); }
  finally { client.release(); }
};

exports.update = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    const cur = (await client.query(`SELECT process_id FROM boms WHERE id = $1 AND is_deleted = FALSE`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ message: 'Không tìm thấy định mức' });
    // process_id hiệu lực sau cập nhật (nếu client gửi thì dùng, không thì giữ nguyên)
    const effPid = b.process_id !== undefined ? (b.process_id || null) : (cur.process_id || null);

    await client.query('BEGIN');
    const fields = ['product_id','name','bom_type','output_quantity','output_unit','status','note','process_id'];
    const cols = [], vals = []; let i = 1;
    for (const f of fields) if (b[f] !== undefined) { cols.push(`${f} = $${i++}`); vals.push(f === 'output_unit' ? upUnit(b[f]) : (b[f] === '' ? null : b[f])); }
    if (cols.length) {
      const r = await client.query(`UPDATE boms SET ${cols.join(', ')} WHERE id = $${i} AND is_deleted = FALSE RETURNING id`, [...vals, req.params.id]);
      if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy định mức' }); }
    }
    // Gắn quy trình → dòng NVL lấy từ quy trình (bỏ qua dòng nhập tay); ngược lại lưu dòng nhập tay
    if (effPid) await syncLinkedBom(client, effPid);
    else if (b.lines !== undefined) await saveLines(client, req.params.id, b.lines);
    await client.query('COMMIT');
    res.json({ message: 'Đã cập nhật định mức' });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: clientMessage(err, 'Lỗi khi cập nhật') }); }
  finally { client.release(); }
};

exports.remove = async (req, res) => {
  try {
    const g = await guardDelete('boms', req.params.id, {
      blocked: ['Hoạt động'],
      message: 'Không thể xóa định mức đang "Hoạt động" — có thể đang dùng để tính NVL/sản xuất. Vui lòng chuyển sang "Không hoạt động" trước, rồi mới xóa.',
    });
    if (g.notFound) return res.status(404).json({ message: 'Không tìm thấy định mức' });
    if (g.blocked) return res.status(400).json({ message: g.message });

    const { rowCount } = await db.query(`UPDATE boms SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy định mức' });
    res.json({ message: 'Đã xóa định mức' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa' }); }
};
