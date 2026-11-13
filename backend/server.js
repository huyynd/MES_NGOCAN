// backend/server.js — khởi động API (cấu hình ở app.js)
const app = require('./app');
const { ensureSeedAdmin } = require('./src/modules/auth/authController');
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MES API chạy tại http://localhost:${PORT}`);
  ensureSeedAdmin();
});
