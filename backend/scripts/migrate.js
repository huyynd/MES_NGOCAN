// backend/scripts/migrate.js — Nạp schema vào database (schema_consolidated.sql)
const path = require('path');
const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const fs = require('fs');
const { Pool } = require('pg');

async function main() {
  const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'mes',
      };

  const pool = new Pool(poolConfig);
  const schemaFile = path.join(ROOT, 'migrations', 'schema_consolidated.sql');

  try {
    console.log(`📦 Đang nạp schema từ: ${schemaFile}`);
    const sql = fs.readFileSync(schemaFile, 'utf8');
    const postMigrationMarker = '-- POST-MIGRATION (idempotent)';
    const postMigrationIndex = sql.indexOf(postMigrationMarker);

    if (postMigrationIndex === -1) {
      throw new Error(`Không tìm thấy mốc "${postMigrationMarker}" trong schema.`);
    }

    const baseSchema = sql.slice(0, postMigrationIndex);
    const expectedTables = [
      ...baseSchema.matchAll(/^\s*CREATE TABLE\s+(?:IF NOT EXISTS\s+)?public\.([a-zA-Z_]\w*)/gim),
    ].map((match) => match[1]);

    if (expectedTables.length === 0) {
      throw new Error('Không tìm thấy bảng nền trong schema_consolidated.sql.');
    }

    const existingTablesResult = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [expectedTables],
    );
    const existingTables = new Set(existingTablesResult.rows.map((row) => row.table_name));

    if (existingTables.size === 0) {
      await pool.query(sql);
      console.log('  ✓ Đã khởi tạo schema_consolidated.sql');
    } else if (expectedTables.every((tableName) => existingTables.has(tableName))) {
      await pool.query(sql.slice(postMigrationIndex));
      console.log('  ✓ Schema nền đã tồn tại; chỉ áp dụng phần cập nhật idempotent');
    } else {
      const missingTables = expectedTables.filter((tableName) => !existingTables.has(tableName));
      throw new Error(
        `Schema nền chưa hoàn chỉnh (${existingTables.size}/${expectedTables.length} bảng). ` +
        `Thiếu: ${missingTables.join(', ')}. Dừng để tránh chạy lại bản dump trên database hiện có.`,
      );
    }

    const tablesRes = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`);
    console.log(`✅ Migrate xong. Các bảng: ${tablesRes.rows.map(r => r.table_name).join(', ')}`);
  } catch (err) {
    console.error('❌ Migrate lỗi:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
