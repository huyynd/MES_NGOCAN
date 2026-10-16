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

// ROLLBACK AN TOÀN cho mọi transaction (`const client = await db.pool.connect()`):
// Mẫu chung trong controller là `catch (err) { await client.query('ROLLBACK'); ... } finally { client.release(); }`.
// Nếu chính ROLLBACK lỗi (kết nối trục trặc), lỗi đó (a) che mất lỗi thật + câu trả lời đúng cho người dùng
// (vd "không đủ tồn kho" thành "Lỗi máy chủ nội bộ"), (b) kết nối không rõ còn transaction hay không
// vẫn được trả về pool cho request sau dùng lại.
// → ROLLBACK lỗi: chỉ ghi log, KHÔNG ném; khi release thì báo lỗi cho pool để HỦY kết nối đó (không tái sử dụng).
// Chỉ áp cho ROLLBACK trơn — "ROLLBACK TO SAVEPOINT" (import từng dòng) vẫn ném lỗi như cũ.
const ROLLBACK_RE = /^\s*ROLLBACK\s*;?\s*$/i;
const rawConnect = pool.connect.bind(pool);
pool.connect = function connect(cb) {
  if (typeof cb === 'function') return rawConnect(cb); // kiểu callback (pool.query dùng nội bộ) — giữ nguyên
  return rawConnect().then((client) => {
    if (!client.__safeRollback) { // client được pool tái sử dụng → chỉ bọc query 1 lần
      const query = client.query.bind(client);
      client.query = function safeQuery(text, ...rest) {
        if (typeof text === 'string' && ROLLBACK_RE.test(text)) {
          return query(text, ...rest).catch((e) => {
            client.__rollbackErr = e;
            console.error('[ROLLBACK lỗi — kết nối sẽ bị hủy, không trả về pool]', e.message);
            return null;
          });
        }
        return query(text, ...rest);
      };
      client.__safeRollback = true;
    }
    const release = client.release; // pg-pool gán release MỚI mỗi lần cấp kết nối → bọc lại mỗi lần
    client.release = (err) => {
      const e = err || client.__rollbackErr;
      client.__rollbackErr = null;
      return release(e);
    };
    return client;
  });
};

module.exports = { query: (text, params) => pool.query(text, params), pool };
