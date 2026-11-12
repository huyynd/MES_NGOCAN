# Triển khai MES (Vercel + Render + PostgreSQL/Supabase)

Tài liệu này mô tả cấu hình đang được mã nguồn hỗ trợ. Mục tiêu là deploy code mà **không tự ý thay đổi dữ liệu hoặc cấu trúc database**.

## Thành phần triển khai

| Thành phần | Nơi chạy | Cấu hình chính |
|---|---|---|
| Frontend React/Vite | Vercel | `VITE_API_BASE` khi cần đổi URL API |
| Backend Express | Render | `backend/`, Start Command `npm start` |
| Database PostgreSQL | Supabase hoặc PostgreSQL quản lý riêng | `DATABASE_URL` trên Render |

`vercel.json` chuyển mọi URL frontend về `index.html` để React Router hoạt động khi mở trực tiếp một trang.

## 1. Biến môi trường

### Backend local: `backend/.env`

File này chỉ dùng trên máy lập trình và bị Git bỏ qua. Không commit, không gửi qua chat.

```env
# Cách khuyến nghị: một chuỗi kết nối PostgreSQL
DATABASE_URL=postgresql://postgres:<PASSWORD>@<HOST>:5432/postgres?sslmode=require

# Hoặc dùng các biến tách rời cho PostgreSQL local
# PGHOST=localhost
# PGPORT=5432
# PGUSER=postgres
# PGPASSWORD=<PASSWORD>
# PGDATABASE=mes

PORT=4000
# Khi chạy frontend local:
CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

`backend/src/core/db.js` ưu tiên `DATABASE_URL`; nếu không có mới dùng các biến `PG*`. Vì vậy một máy local có thể kết nối DB Supabase bằng `DATABASE_URL` mà không đổi code.

### Backend production: Render → Environment

Đặt tối thiểu các biến sau trên dịch vụ backend:

```text
NODE_ENV=production
DATABASE_URL=<Supabase/PostgreSQL connection string>
CORS_ORIGINS=https://<ten-du-an>.vercel.app
JWT_SECRET=<chuỗi bí mật dài, riêng cho môi trường production>
```

- Thêm nhiều frontend vào `CORS_ORIGINS` bằng dấu phẩy, không thêm dấu `/` ở cuối origin.
- `JWT_SECRET` phải có ở production; backend sẽ dừng khởi động nếu thiếu.
- Thay đổi biến trong Render tạo một deploy/restart mới, nhưng **không** làm file `backend/.env` local xuất hiện trên Render.

### Frontend: `.env.local` ở thư mục gốc (tùy chọn)

```env
VITE_API_BASE=http://127.0.0.1:4000
```

Biến `VITE_*` được nhúng lúc Vite build. Nếu không đặt, frontend hiện dùng URL API mặc định trong `src/mesApi.js`. Không đưa `DATABASE_URL`, mật khẩu hay khóa bí mật vào biến `VITE_*` vì chúng có thể lộ ra trình duyệt.

## 2. Lệnh chạy local

Mở hai terminal:

```powershell
# Terminal 1
cd backend
npm install
npm start
```

```powershell
# Terminal 2, tại thư mục gốc dự án
npm install
npm run dev -- --host 127.0.0.1
```

Kiểm tra backend trước khi đăng nhập:

```powershell
Invoke-WebRequest http://127.0.0.1:4000/health
```

Kết quả đúng có HTTP 200 và `{"ok":true}`. Nếu frontend local gọi Render thay vì backend local, kiểm tra lại `VITE_API_BASE`, sau đó dừng/chạy lại Vite để nạp biến mới.

## 3. Deploy an toàn

### Backend Render

`render.yaml` đã khai báo:

```text
rootDir: backend
buildCommand: npm install
startCommand: npm start
```

Trên Render Dashboard, Start Command phải là đúng `npm start`. Dashboard có thể ghi đè `render.yaml`; kiểm tra lại sau mỗi lần đổi service.

Không dùng `npm run migrate && npm start` làm Start Command nếu mục tiêu chỉ là deploy code. Cấu hình đó chạy migration ở mọi lần deploy và có thể áp lại phần cập nhật idempotent của schema.

Sau deploy, mở:

```text
https://<render-service>.onrender.com/health
```

Sau đó thử đăng nhập từ domain Vercel. Nếu request `OPTIONS /api/auth/login` trả `403`, origin frontend chưa có trong `CORS_ORIGINS`.

### Frontend Vercel

1. Đặt `VITE_API_BASE=https://<render-service>.onrender.com` trong Vercel Environment Variables nếu không dùng URL mặc định trong code.
2. Redeploy frontend sau khi đổi bất kỳ biến `VITE_*` nào.
3. Kiểm tra Network trên trình duyệt: request đăng nhập phải gọi đúng Render URL và không bị CORS chặn.

## 4. Migration database: chỉ chạy khi chủ động

Lệnh migration:

```powershell
cd backend
npm run migrate
```

Script nạp `backend/migrations/schema_consolidated.sql` và có cơ chế bảo vệ:

- Database chưa có bảng nền: chạy toàn bộ schema để khởi tạo.
- Database đã có đầy đủ bảng nền: chỉ chạy phần sau mốc `-- POST-MIGRATION`.
- Database chỉ có một phần bảng nền: script dừng với lỗi, không cố ghi đè schema.

Phần post-migration được viết theo hướng idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), nhưng vẫn có thể có thay đổi dữ liệu hoặc ràng buộc. Vì thế trước khi migrate production:

1. Sao lưu DB bằng Supabase Backups hoặc `pg_dump`.
2. Kiểm tra nội dung diff của `schema_consolidated.sql` và xác nhận đúng `DATABASE_URL` đang trỏ tới DB cần nâng cấp.
3. Chạy `npm run migrate` một lần từ môi trường được kiểm soát.
4. Kiểm tra `/health`, đăng nhập, Tồn kho, Lệnh sản xuất, Giao hàng/Công nợ và báo cáo.

Các file trong `backend/migrations/manual/` là thao tác thủ công; chúng không được `npm run migrate` tự động thực thi.

## 5. Checklist trước và sau deploy

### Trước deploy

- [ ] `npm run build` ở thư mục gốc thành công.
- [ ] `DATABASE_URL`, `CORS_ORIGINS`, `JWT_SECRET` đã đặt đúng ở Render.
- [ ] Nếu thay DB: đã test kết nối tới DB mới và có backup DB production.
- [ ] Nếu có thay đổi schema: đã quyết định rõ có chạy migration thủ công hay không.

### Sau deploy

- [ ] `/health` trả 200.
- [ ] Đăng nhập thành công từ domain frontend.
- [ ] Không có 403 CORS hoặc 401 bất thường ở Network.
- [ ] Kiểm thử nhanh luồng có liên quan đến thay đổi vừa deploy.
- [ ] Lưu log/backup migration nếu đã chạy.
