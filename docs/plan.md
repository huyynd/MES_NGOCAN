# Kế hoạch và trạng thái phát triển MES

> Cập nhật: 12-11-2026. Trạng thái trong tài liệu được suy ra từ mã nguồn hiện có; chỉ nghiệm thu nghiệp vụ thực tế mới xác nhận “hoàn thành” tại nhà máy.

## Phạm vi hiện có

Hệ thống đã có các nhóm chức năng sau:

| Nhóm | Chức năng hiện có |
|---|---|
| Danh mục | Khách hàng, nhân viên, máy, ca, kho, khu vực, vị trí, vai trò, tài khoản |
| Kỹ thuật | Sản phẩm, tệp đính kèm sản phẩm, BOM, quy trình/công đoạn |
| Bán hàng | Đơn hàng, import đơn, giao hàng nhiều đơn, trả hàng, phiếu thu, công nợ và số dư đầu kỳ |
| Sản xuất | Kế hoạch/MRP, lệnh SX, phân công/công đoạn, Gantt, thực thi, nhu cầu/xuất/trả NVL |
| Kho | Tồn dạng danh sách/cây, nhập, điều chỉnh, điều chuyển, phiếu xuất, lịch sử, QR và truy xuất lô |
| Chất lượng/tái chế | Ghi nhận phế theo ngày, tổng hợp phế, vé tái chế và cuộn tái chế |
| Báo cáo | KPI, chi tiết, theo máy/nhân viên, báo cáo giám đốc, báo cáo kho, báo cáo sản lượng |
| Hệ thống | JWT, phân quyền vai trò/user, cài đặt hệ thống, health check, CORS/rate-limit |

## Ưu tiên vận hành (P0)

- [ ] Chốt một database production chính thức, sao lưu định kỳ và thử khôi phục trên môi trường tách biệt.
- [ ] Giữ Render Start Command là `npm start`; không chạy migration tự động cùng deploy code.
- [ ] Mỗi thay đổi schema phải có checklist: backup → review SQL → chạy thủ công → smoke test → lưu log.
- [ ] Duy trì biến môi trường tách biệt local/production; không commit `.env`, không đưa secret vào `VITE_*`.
- [ ] Thực hiện smoke test sau deploy: `/health`, đăng nhập, tồn kho, lệnh SX, giao hàng/công nợ, báo cáo liên quan.

## Ưu tiên sản phẩm và kỹ thuật (P1)

- [ ] Rà soát quyền **đọc** và phạm vi dữ liệu của mọi API; hiện nhiều route ghi đã có middleware, nhưng quyền cần được kiểm thử theo từng vai trò.
- [ ] Chuẩn hóa dữ liệu nhân sự/ca dùng ID nhất quán ở các luồng sản xuất và báo cáo; hạn chế liên kết theo chuỗi tên.
- [ ] Chuẩn hóa một đầu mối ghi sổ kho, đảm bảo mọi nhánh cộng/trừ tạo transaction và cập nhật tồn đồng nhất.
- [ ] Viết bộ test tích hợp cho luồng đơn hàng → lệnh SX → xuất/trả NVL → hoàn thành → giao hàng/thu tiền.
- [ ] Kiểm thử nghiệp vụ tính sản lượng/phế trong các trường hợp lệnh hủy, nhiều công đoạn và chỉnh sửa ghi phế cùng ngày.
- [ ] Theo dõi lỗi production (log tập trung/alert) và thiết lập cảnh báo health check.

## Ưu tiên cải tiến (P2)

- [ ] Chia nhỏ bundle frontend bằng lazy loading các báo cáo/module nặng.
- [ ] Bổ sung audit log truy vết ai thay đổi dữ liệu, thời điểm và giá trị trước/sau.
- [ ] Cảnh báo tồn dưới ngưỡng, lệnh trễ và công nợ vượt hạn mức.
- [ ] Nâng quy trình import Excel: validate rõ ràng hơn, preview và báo lỗi theo dòng.
- [ ] Bổ sung báo cáo xu hướng, deadline scheduling và chỉ số vận hành sau khi dữ liệu nền ổn định.

## Quy ước thay đổi

### Thay đổi code

1. Cập nhật tính năng và quyền API tương ứng.
2. Chạy `npm run build` ở thư mục gốc.
3. Nếu đổi backend, kiểm tra ít nhất cú pháp Node của file thay đổi và endpoint liên quan.
4. Cập nhật [ARCHITECTURE.md](ARCHITECTURE.md) khi thay đổi ranh giới module, auth, router hoặc deploy.

### Thay đổi database

1. Không chạy SQL trực tiếp lên production trước khi có backup.
2. Cập nhật `backend/migrations/schema_consolidated.sql` theo hướng có thể chạy lặp lại an toàn khi phù hợp.
3. Kiểm thử trên database copy/đại diện trước.
4. Chạy `cd backend; npm run migrate` thủ công sau khi xác nhận đúng `DATABASE_URL`.
5. Cập nhật [phan-tich-csdl.md](phan-tich-csdl.md) nếu có bảng, quan hệ hoặc nguyên tắc lưu dữ liệu mới.

### Thay đổi deploy

Theo [DEPLOY.md](DEPLOY.md). Đổi biến môi trường Render/Vercel cần redeploy/restart tương ứng nhưng không phải commit file `.env`.

## Chỉ số nghiệm thu đề xuất

| Hạng mục | Tiêu chí tối thiểu |
|---|---|
| Bảo mật | Token hết hạn/đăng xuất bị từ chối; tài khoản thiếu quyền nhận 403 ở API ghi |
| Kho | Không âm tồn ngoài trường hợp được chủ động cho phép; tồn và lịch sử giao dịch khớp |
| Sản xuất | Sản lượng, phế và trạng thái lệnh đúng với công đoạn; lệnh hủy không cộng sản lượng |
| Bán hàng | Số lượng giao/trả, phiếu thu và công nợ nhất quán |
| Deploy | Health check thành công, không lỗi CORS, không migration ngoài ý muốn |
