// backend/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const productsRouter = require('./src/modules/engineering/product.route');
const apiRouter = require('./src/routes');
const requireAuth = require('./src/core/requireAuth');
const { ensureSeedAdmin } = require('./src/modules/auth/authController');

const app = express();

// ── Bảo mật HTTP Headers ──────────────────────────────────────────────────────
app.use(helmet());

// ── CORS — chỉ cho phép frontend đã cấu hình ───────────────────────────────────
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://mesngocan-src.vercel.app',
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
// Giới hạn chung: 200 req / phút / IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
}));

// Giới hạn nghiêm hơn cho endpoint đăng nhập: 10 req / phút / IP
app.use('/api/auth/login', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
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
  console.error('[Unhandled]', err);
  res.status(500).json({ message: 'Lỗi máy chủ nội bộ' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MES API chạy tại http://localhost:${PORT}`);
  ensureSeedAdmin();
});
