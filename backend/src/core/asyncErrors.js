// backend/src/core/asyncErrors.js — LƯỚI AN TOÀN cho lỗi trong handler async (Express 4)
//
// Express 4 KHÔNG bắt Promise bị reject từ handler `async` → lỗi không tới error handler cuối (server.js),
// thành unhandled rejection và Node ≥15 TẮT luôn tiến trình (mọi người dùng mất kết nối).
// Rủi ro có ở mọi handler: `await db.pool.connect()` đặt trước `try`, hoặc `await client.query('ROLLBACK')`
// trong `catch` (kết nối hỏng → ROLLBACK cũng ném lỗi).
//
// File này vá 1 chỗ cho TOÀN BỘ route: Promise trả về từ handler mà bị reject → chuyển cho next(err)
// → error handler cuối trả 500. Cùng cách với thư viện express-async-errors, không thêm phụ thuộc.
// Phải require TRƯỚC khi khai báo route (đầu server.js). Lên Express 5 thì bỏ file này (Express 5 tự làm).
const Layer = require('express/lib/router/layer');

if (!Layer.prototype.__asyncPatched) {
  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // error middleware (4 tham số) — giữ nguyên hành vi Express
    try {
      const ret = fn(req, res, next);
      if (ret && typeof ret.catch === 'function') {
        ret.catch((err) => next(err || new Error('Lỗi không xác định trong handler async')));
      }
    } catch (err) {
      next(err);
    }
  };
  Layer.prototype.__asyncPatched = true;
}

// Lưới cuối: Promise bị reject ngoài request (vd tác vụ nền) → GHI LOG, không để tắt server.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
