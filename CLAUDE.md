# Project MES — Bao Bì Ngọc An Thư

Hệ thống MES (Manufacturing Execution System) cho nhà máy bao bì nhựa. Web app quản lý: đơn hàng/kinh doanh, sản xuất, tồn kho, kỹ thuật (BOM/specs), tái chế, master data, báo cáo giám đốc.

> **Ngôn ngữ trả lời: tiếng Việt.** Người dùng là chủ dự án, không phải dev chuyên sâu — ưu tiên giải thích rõ ràng, tránh thuật ngữ thừa.

---

## Stack & cách chạy

**Frontend:** React 18 + react-router (SPA), Vite 5 (port 5173), Tailwind, recharts, react-hot-toast.
- Entry: `MesApp.jsx` (root, ~1360 dòng) + `src/` modules.
- Chạy: `npm run dev`

**Backend:** Express + node-pg (port 4000).
- Entry: `backend/server.js`
- Chạy: `cd backend && npm run dev` (hoặc `npm start`)
- Migrate DB: `cd backend && npm run migrate`

**DB:** PostgreSQL, database tên `mes`. Credentials nằm trong `backend/.env` (gitignored — KHÔNG hardcode mật khẩu vào code hay file commit). Login app: admin / admin123.

---

## Cấu trúc module

Backend và frontend chia **cùng 7 nhóm nghiệp vụ**:
`auth · sales · production · inventory · engineering · masterData · recycling` (+ `reports` ở frontend).

- **Backend module:** `backend/src/modules/<nhóm>/` gồm `*.route.js` + `*Controller.js`.
- **Backend core:** `backend/src/core/db.js`, `genericCrud.js`, và `core/lib/`:
  - `stock.js` — `applyStock(client, {product_id, location_id, delta, unit, specs, spec_key, lot_code, clampZero, trx_type, ref_code, note})`: **hàm duy nhất** để thay đổi tồn kho + ghi `inventory_transactions`. Luôn mutate tồn qua đây, đừng UPDATE trực tiếp.
  - `specs.js` — `buildSpecKey(specs)` = `SPEC_NAMES.map(n => s[n]||'').join('|')`. Specs rỗng → `'||||'` (5 trường, 4 dấu `|`), **KHÔNG phải** `''`. SPEC_NAMES = ['Số lớp','Chiều dài','Chiều ngang (Rộng)','Độ dày','Màu sắc'].
  - `money.js` — `canViewAmounts(req, app)`: cổng phân quyền xem tiền.
  - `units.js`, `deleteGuard.js`, `bomSync.js`.
- **Frontend module:** `src/modules/<nhóm>/`. Dùng chung component ở `src/components.jsx`.

## Quy ước quan trọng

- **Tồn kho < 0:** không cho phép. Trừ tồn phải `SELECT ... FOR UPDATE` trong transaction (chống 2 phiếu trừ cùng lúc → cái save trước thắng, cái sau load lại + cảnh báo).
- **Giao hàng:** state machine `DN_TRANSITIONS` trong `deliveryController.js`. Đơn tạo ra luôn ở trạng thái 'Bản nháp'. Giao vượt số lượng (over-delivery) chỉ **cảnh báo**, không chặn — đúng với nghiệp vụ của họ.
- **Sản xuất:** trạng thái 'Hoàn thành' không cho sửa; đã có `posted_qty > 0` thì không cho đổi sản phẩm.
- **Import từng dòng:** dùng SAVEPOINT / ROLLBACK TO SAVEPOINT để cô lập lỗi từng dòng.

## Mobile

App mobile ở repo **riêng**: `xone184/MES_Mobile` (Expo + React Native + TS). Thư mục `/mobile/` được gitignore, không thuộc repo này.

---

## ⚡ Quy trình làm việc tối ưu token

Context được gửi lại toàn bộ mỗi lượt chat, nên phiên càng dài càng tốn. Giữ các nguyên tắc sau:

1. **Mỗi việc = 1 phiên.** Xong 1 đầu việc (fix xong 1 cụm lỗi, build xong 1 tính năng) → `/clear` hoặc mở session mới. Đừng dồn nhiều việc không liên quan vào 1 phiên dài.
2. **Giao việc cụ thể.** Chỉ đúng file:dòng khi biết được (vd "sửa `inventoryController.js` chỗ validate số lượng") thay vì mô tả chung chung — để đỡ phải đọc dò nhiều file.
3. **Quét rộng → dùng subagent Explore.** Khi cần tìm "chỗ nào dùng X" trên nhiều file, giao cho agent Explore: nó quét ở ngăn riêng, chỉ trả kết luận.
4. **Đọc có mục tiêu.** Với file lớn (`MesApp.jsx`, `productionController.js`), đọc đúng đoạn cần (offset/limit) thay vì cả file.
5. **Không đọc lại file vừa sửa** để "kiểm tra" — nếu Edit báo thành công là đã đúng.
6. **File test & tài liệu rà soát:** giữ local, KHÔNG commit (đã có pattern trong `.gitignore`: `test_*.js`, `test-*.js`, `*.test.js`, `docs/ai/`...).
