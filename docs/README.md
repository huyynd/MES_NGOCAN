# Tài liệu dự án MES

| Tài liệu | Mục đích |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kiến trúc frontend, backend, xác thực, dữ liệu và module |
| [DEPLOY.md](DEPLOY.md) | Chạy local, biến môi trường, Render/Vercel và migration an toàn |
| [phan-tich-csdl.md](phan-tich-csdl.md) | Bản đồ bảng/luồng dữ liệu theo migration hiện tại |
| [plan.md](plan.md) | Phạm vi chức năng, ưu tiên vận hành và backlog kỹ thuật |
| `PLAN_SERVER_NOI_BO.md` | Ghi chú/kế hoạch server nội bộ, do người dùng quản lý cục bộ |
| `_srs_extracted.txt`, `_khgbb_yeucau.txt` | Tài liệu nguồn đã trích xuất; không chỉnh sửa tự động |

## Quy tắc cập nhật

- Cập nhật `ARCHITECTURE.md` khi đổi cấu trúc module, xác thực, router hoặc hạ tầng deploy.
- Cập nhật `DEPLOY.md` khi đổi biến môi trường, lệnh khởi động hoặc quy trình migration.
- Cập nhật `phan-tich-csdl.md` khi đổi bảng, quan hệ hay nguyên tắc ghi dữ liệu.
- Không ghi secret, URL kết nối có mật khẩu, dump khách hàng hoặc file `.env` vào tài liệu được commit.
