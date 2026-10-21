// backend/server.js
const express = require('express');
require('./src/core/asyncErrors'); // lỗi trong handler async → error handler cuối (500), không sập server
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const productsRouter = require('./src/modules/engineering/product.route');
const apiRouter = require('./src/routes');
const requireAuth = require('./src/core/requireAuth');
const { ensureSeedAdmin } = require('./src/modules/auth/authController');

// Deploy marker: cấu hình môi trường (đặc biệt DATABASE_URL) được quản lý trên Render, không commit file .env.

const app = express();

// ── IP thật của người dùng khi chạy sau proxy (Render, Nginx...) ──────────────
// Không có dòng này, sau proxy mọi request đều mang IP của proxy → giới hạn đăng nhập / tần suất
// bị tính CHUNG cho cả công ty. TRUST_PROXY = số tầng proxy phía trước (Render: 1).
// Chạy trực tiếp (máy dev, LAN) thì để trống: KHÔNG tin header X-Forwarded-For (tránh giả IP).
// Trên Render tự bật 1 tầng (Render luôn đặt biến môi trường RENDER).
const trustProxy = process.env.TRUST_PROXY ?? (process.env.RENDER ? '1' : '');
if (trustProxy !== '') app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

// ── Bảo mật HTTP Headers ──────────────────────────────────────────────────────
app.use(helmet());

// ── CORS — chỉ cho phép frontend đã cấu hình ───────────────────────────────────
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://mesngocan-src.vercel.app',
  'https://mes-ngocan.vercel.app',
];
const CONFIGURED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
const ALLOWED_ORIGINS = [...new Set([...DEFAULT_ORIGINS, ...CONFIGURED_ORIGINS])];

app.use(cors({
  origin: (origin, cb) => {
    // Cho phép request không có origin (curl, Postman, server-to-server)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: Origin "${origin}" không được phép`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Giới hạn chung theo IP. Cả xưởng dùng chung 1 Wi-Fi = 1 IP (nhiều điện thoại + máy tính)
// nên mặc định 1000 req / phút / IP; chỉnh bằng RATE_LIMIT_PER_MIN nếu cần.
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MIN) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
}));

// Giới hạn số lần gọi đăng nhập theo IP: 60 lần / phút (đầu ca cả xưởng đăng nhập cùng lúc).
// Chống dò mật khẩu thật sự nằm ở authController (khóa theo tài khoản + IP / tài khoản / IP).
app.use('/api/auth/login', rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_PER_MIN) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Quá nhiều lần thử đăng nhập, vui lòng thử lại sau.' },
}));

// ── Body parser — giới hạn 2mb (trừ route upload tệp đính kèm) ───────────────
app.use(express.json({ limit: '2mb' }));
// Route upload tệp (base64 ảnh/tài liệu) cần giới hạn cao hơn
app.use('/api/products/:id/attachments', express.json({ limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/products', requireAuth, productsRouter);
app.use('/api', apiRouter);
app.get('/health', (_, res) => res.json({ ok: true }));

// ── Error handler cuối cùng ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.message?.startsWith('CORS')) return res.status(403).json({ message: err.message });
  console.error('[Unhandled]', req.method, req.originalUrl, err);
  if (res.headersSent) return; // đã trả một phần → không gửi lại (tránh lỗi "headers already sent")
  res.status(500).json({ message: 'Lỗi máy chủ nội bộ' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MES API chạy tại http://localhost:${PORT}`);
  ensureSeedAdmin();
});
