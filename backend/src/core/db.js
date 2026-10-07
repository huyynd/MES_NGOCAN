// backend/db.js — kết nối PostgreSQL bằng connection pool
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool, types } = require('pg');

// Trả cột DATE (OID 1082) nguyên chuỗi 'YYYY-MM-DD', tránh lệch ngày do timezone
types.setTypeParser(1082, (v) => v);

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'mes',
    };

const pool = new Pool({
  ...poolConfig,
  max: 10,
  // M01: không chờ kết nối vô hạn — pool cạn thì request lỗi sau 10s thay vì treo cả hệ thống.
  connectionTimeoutMillis: 10000,
  // Phiên bỏ dở giữa transaction (lỗi code / client mất kết nối) tự huỷ sau 30s, trả kết nối về pool.
  idle_in_transaction_session_timeout: 30000,
});

module.exports = { query: (text, params) => pool.query(text, params), pool };
