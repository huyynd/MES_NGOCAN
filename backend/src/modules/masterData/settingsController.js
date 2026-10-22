const db = require('../../core/db');
const { DEFS, getAppSettings, validateSetting } = require('../../core/lib/settings');

// GET /api/app-settings — danh sách cài đặt (nhãn, kiểu, giới hạn) + giá trị hiện tại. Chỉ Admin (route).
exports.list = async (req, res) => {
  const values = await getAppSettings(db);
  const items = Object.entries(DEFS).map(([key, d]) => ({ key, group: d.group, label: d.label, type: d.type, min: d.min, max: d.max, hint: d.hint || null, default: d.def, value: values[key] }));
  res.json({ data: items });
};

// PUT /api/app-settings  body { values: { key: value, ... } } — kiểm từng giá trị, lưu cả lô trong 1 transaction
exports.save = async (req, res) => {
  const input = req.body?.values;
  if (!input || typeof input !== 'object') return res.status(400).json({ message: 'Thiếu dữ liệu cài đặt' });
  const clean = {}; const errors = [];
  for (const [k, v] of Object.entries(input)) {
    const r = validateSetting(k, v);
    if (r.error) errors.push(r.error); else clean[k] = r.value;
  }
  if (errors.length) return res.status(400).json({ message: errors.join('\n') });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const [k, v] of Object.entries(clean)) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, JSON.stringify(v)]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  res.json({ message: 'Đã lưu cài đặt', values: await getAppSettings(db) });
};
