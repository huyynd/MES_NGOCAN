# MES — Bao Bì Ngọc An Thư

Hệ thống MES (Manufacturing Execution System) cho nhà máy sản xuất bao bì nhựa (túi nilon, cuộn nilon). Quản lý xuyên suốt: **Đơn hàng → Kế hoạch → Lệnh sản xuất → Phân công/QR → Tồn kho → Dashboard**, kèm đăng nhập và phân quyền theo vai trò.

## Công nghệ

| Lớp | Công nghệ |
|---|---|
| Frontend | React 18, Vite 5, Tailwind CSS |
| Backend | Node.js, Express 4 |
| Database | PostgreSQL 17 |
| Khác | SheetJS (xlsx), qrcode, scrypt (băm mật khẩu) |

## Tính năng chính

- **Danh mục**: Sản phẩm, Khách hàng, Máy móc, Nhân viên, Ca, Kho, Vị trí, Vai trò (kèm Import/Export Excel).
- **Định mức (BOM)** + công thức pha màu; **Quy trình công nghệ** (các bước NVL→TP, %thành phẩm/%phế, lưu đồ).
- **Đơn hàng** (phiếu in được) → **Kế hoạch** (gom lô, tính NVL/MRP) → **Lệnh sản xuất** (phân công theo công đoạn, Gantt).
- **Tem QR** theo lô/công đoạn + **quét QR** cập nhật sản lượng; **tồn kho tự động** (backflush khi hoàn thành lệnh).
- **Lịch làm việc** (nhân sự/ca), **Dashboard** số liệu thực.
- **Đăng nhập** + **phân quyền** theo vai trò → ứng dụng → từng trường (xem/sửa/ẩn).

## Cấu trúc thư mục

```
.
├── MesApp.jsx          # App gốc (sidebar, định tuyến, sản phẩm, dashboard)
├── src/                # Module frontend (modules/, components.jsx, mesApi.js, perm.jsx ...)
├── index.html          # Cấu hình Tailwind + thương hiệu
├── public/             # Logo, tài nguyên tĩnh
└── backend/
    ├── server.js       # Express entrypoint (cổng 4000)
    ├── db.js           # Pool PostgreSQL (đọc .env)
    ├── migrate.js      # Chạy toàn bộ schema*.sql
    ├── routes/         # mes.js, products.js
    ├── controllers/    # Logic từng phân hệ
    └── schema*.sql     # Lược đồ CSDL (theo phiên bản)
```

## Cài đặt & chạy

### 1. Yêu cầu
- Node.js 18+
- PostgreSQL 17 (tạo sẵn database tên `mes`)

### 2. Backend
```bash
cd backend
npm install
# Tạo file .env (xem mẫu bên dưới)
npm run migrate     # khởi tạo schema trên database mới; có thể chạy lại an toàn
npm run dev         # chạy API tại http://localhost:4000
```

Trên Render, đặt **Start Command** là `npm start`. Không cần ghép `npm run migrate && npm start`: migration tự nhận diện schema đã khởi tạo và chỉ chạy phần cập nhật idempotent, không nạp lại bản dump tạo bảng mỗi lần deploy.

File **`backend/.env`** (không commit lên git):
```
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=<mật khẩu PostgreSQL của bạn>
PGDATABASE=mes
PORT=4000
```

### 3. Frontend
```bash
# tại thư mục gốc dự án
npm install
npm run dev         # chạy giao diện tại http://localhost:5173
```

### 4. Đăng nhập lần đầu
Tài khoản quản trị được tạo tự động:
- Tài khoản: **admin**
- Mật khẩu: **admin123**

> Nên đổi mật khẩu admin sau khi đăng nhập.

## Ghi chú
- Phân quyền hiện được kiểm soát ở **phía client**; nếu cần siết chặt có thể bổ sung kiểm tra ở phía server.
- Các file `.env`, `node_modules/`, `pgadmin-servers.json` đã được loại khỏi git.
