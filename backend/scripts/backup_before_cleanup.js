// Sao lưu "ra 1 góc" NGAY TRONG DB (schema backup_cleanup) các bảng mà cleanup_before_cutoff.js đụng tới,
// để quay lại được nếu có vấn đề.
//
//   node scripts/backup_before_cleanup.js            → tạo bản sao lưu (báo lỗi nếu đã có — tránh ghi đè bản cũ)
//   node scripts/backup_before_cleanup.js --restore  → KHÔI PHỤC các bảng về đúng lúc sao lưu
//   node scripts/backup_before_cleanup.js --drop     → xóa bản sao lưu (khi đã chắc chắn ổn)
//
// LƯU Ý khi --restore: dữ liệu nhập vào các bảng này SAU lúc sao lưu cũng bị mất (về đúng thời điểm sao lưu).
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../src/core/db');

const SCHEMA = 'backup_cleanup';
// Thứ tự con → cha (xóa theo thứ tự này, chèn lại theo thứ tự ngược)
const TABLES = [
  'opening_balance_payments', 'delivery_payments', 'payment_receipts',
  'delivery_return_items', 'delivery_returns', 'outbound_slip_lines', 'outbound_slips',
  'delivery_note_items', 'delivery_notes',
  'production_roll_usage', 'production_material_usage', 'production_order_materials', 'production_tasks',
  'inventory_stock', 'production_orders', 'sales_order_items', 'sales_orders',
  'daily_scrap_items', 'daily_scrap_records', 'recycling_rolls', 'recycling_tickets',
  'work_schedules', 'inventory_transactions',
];
const mode = process.argv.includes('--restore') ? 'restore' : process.argv.includes('--drop') ? 'drop' : 'backup';

async function main() {
  const client = await db.pool.connect();
  try {
    console.log(`DB: ${process.env.DATABASE_URL ? 'DATABASE_URL (từ xa)' : `${process.env.PGHOST || 'localhost'}/${process.env.PGDATABASE || 'mes'}`} — ${mode}\n`);
    const has = async (s, t) => (await client.query(`SELECT to_regclass($1) IS NOT NULL ok`, [`${s}.${t}`])).rows[0].ok;
    const tables = [];
    for (const t of TABLES) if (await has('public', t)) tables.push(t);
    const schemaExists = (await client.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [SCHEMA])).rowCount > 0;

    await client.query('BEGIN');
    if (mode === 'backup') {
      if (schemaExists) throw new Error(`Đã có bản sao lưu ${SCHEMA} — dùng --drop trước nếu muốn sao lưu lại.`);
      await client.query(`CREATE SCHEMA ${SCHEMA}`);
      await client.query(`CREATE TABLE ${SCHEMA}._info AS SELECT now() AS backed_up_at`);
      for (const t of tables) {
        const n = (await client.query(`CREATE TABLE ${SCHEMA}.${t} AS SELECT * FROM public.${t}`)).rowCount;
        console.log(`  ${t.padEnd(30)} ${n}`);
      }
    } else if (mode === 'restore') {
      if (!schemaExists) throw new Error(`Không có bản sao lưu ${SCHEMA}.`);
      const at = (await client.query(`SELECT backed_up_at FROM ${SCHEMA}._info`)).rows[0].backed_up_at;
      console.log(`Khôi phục về lúc sao lưu: ${at.toISOString()}`);
      for (const t of tables) await client.query(`DELETE FROM public.${t}`);
      for (const t of [...tables].reverse()) {
        if (!(await has(SCHEMA, t))) continue;
        const n = (await client.query(`INSERT INTO public.${t} OVERRIDING SYSTEM VALUE SELECT * FROM ${SCHEMA}.${t}`)).rowCount;
        console.log(`  ${t.padEnd(30)} ${n}`);
      }
    } else {
      if (!schemaExists) throw new Error(`Không có bản sao lưu ${SCHEMA}.`);
      await client.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    }
    await client.query('COMMIT');
    console.log(`\n✔ Xong (${mode}).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✘ LỖI — đã ROLLBACK, không có gì thay đổi:', err.message, err.detail || '');
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
