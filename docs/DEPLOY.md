# Ghi chú deploy lên PRD

## Quy trình chung
1. **Sao lưu DB PRD** (Supabase → Backups, hoặc `pg_dump`).
2. Đưa code mới lên (Render tự build backend, Vercel tự build frontend).
3. Nếu bản deploy có mục migrate mới → chạy migrate với `DATABASE_URL` của PRD:
   ```bash
   cd backend && npm run migrate
   ```
   Lệnh chỉ áp khối POST-MIGRATION, chạy lại nhiều lần không sao.
4. Kiểm nhanh: đăng nhập, mở Tồn kho, Báo cáo kho, Báo cáo SX.

> Migrate **không** tự chạy khi deploy: mỗi lần chạy sẽ áp lại toàn bộ các mục sửa dữ liệu
> lên PRD — cần sao lưu trước nên để người chạy chủ động.

## Việc còn chờ trên PRD

| Nhánh / commit | Cần migrate? | Nội dung |
|---|---|---|
| `fix/15-loi-nang` (f56ec70, 66fb3e7) | **Có — mục 24** | Đổi khóa thông số "Chiều ngang" → "Chiều ngang (Rộng)" (~1.400 dòng, giữ nguyên giá trị, `spec_key` không đổi). Code mới vẫn đọc được khóa cũ nên chạy trước/sau deploy code đều được. Các sửa khác chỉ là code, chỉ cần khởi động lại backend. |
| Đợt 2–5 + tối ưu LSX (`fix/dot5-cai-dat`, 2026-10-22) | **Có — mục 25** | Ghi sẵn cài đặt mặc định cho màn **Cài đặt hệ thống** (= giá trị cũ, không ghi đè nếu đã có); kho đang ghi "Nhà máy 1/2/3" → để trống. Backend thêm thư viện `compression` (nén gzip) — Render tự `npm install` khi build. Sau deploy: đăng nhập Admin → mở **Thông tin chung → Cài đặt hệ thống** kiểm các giá trị. |

Chạy xong thì xóa dòng tương ứng khỏi bảng trên.
