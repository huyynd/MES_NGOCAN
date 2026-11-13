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
| `ui/kho-ton-kho` (phiếu xuất kho, 2026-11-09) | **Có — mục 36** | Thêm cột `delivery_note_items.note` (ghi chú dòng, ≤200 ký tự kiểm ở backend); đổi tên/địa chỉ công ty chỉ khi đang đúng giá trị cũ. **Migrate TRƯỚC khi deploy backend** (code mới ghi cột `note`). Thêm endpoint `PUT /deliveries/:id/item-notes`. Sau deploy: SELECT kiểm `company_name`/`company_address` (còn cũ thì sửa tay ở Cài đặt), in thử 1 phiếu bằng 2 tài khoản (có/không quyền xem tiền). |
| Kế hoạch chuyển kỳ (2026-11-13, chưa commit) | **Có — mục 37** | Thêm cột `production_orders.completed_at` / `cancelled_at` + trigger `po_status_dates` + điền ngày ước lượng cho lệnh cũ (theo ngày công đoạn cuối, không đổi `updated_at`) + 2 index mới, xóa 2 index trùng (`idx_tasks_po`, `idx_pt_production_order`) trên `production_tasks`. **Migrate TRƯỚC khi deploy backend** (code mới đọc 2 cột này — thiếu thì Báo cáo GĐ / Báo cáo sản lượng lỗi 500). Nên chạy ngoài giờ SX (khóa bảng lệnh SX vài giây). Kiểm sau migrate: `SELECT count(*) FROM production_orders WHERE status='Hoàn thành' AND completed_at IS NULL` = 0. ⚠️ **KHÔNG** chạy `backend/migrations/manual/2026-11-13_*.sql` trên PRD (chỉ để sửa DB máy dev). Sau deploy: mở Báo cáo GĐ và Báo cáo sản lượng cùng kỳ → số phải khớp; số kế hoạch tháng sẽ tăng (thêm phần chuyển kỳ) — đúng quy tắc mới. |

Chạy xong thì xóa dòng tương ứng khỏi bảng trên.
