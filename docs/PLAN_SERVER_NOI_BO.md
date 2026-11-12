# Kế hoạch chuyển MES Ngọc An Thư sang server riêng

Ngày lập: 06/11/2026. Phạm vi: đánh giá và kế hoạch, chưa thay đổi mã chạy hay dữ liệu production.

Người dùng xác nhận: khoảng 20 người, thường xuyên dùng cả tại xưởng và từ xa. Kế hoạch lấy 20 phiên hoạt động đồng thời làm kịch bản kiểm thử; đây chưa phải tải đã đo.

## 1. Kết luận và điều kiện lựa chọn

Dell OptiPlex 7080 MT có thể làm server cho ứng dụng này. Cấu hình nên mua: Core i5-10500/10600, RAM 32 GB, SSD NVMe TLC 1 TB, ổ sao lưu riêng 1–2 TB, UPS và mạng dây Gigabit. i7-10700 là lựa chọn thêm nếu giá hợp lý hoặc còn chạy ứng dụng khác; không cần GPU rời.

Đây là nhận định từ cấu trúc ứng dụng CRUD/báo cáo, chưa phải kết quả benchmark. Sức chứa thực tế phụ thuộc lượng chứng từ, ảnh, báo cáo, import Excel, chất lượng truy vấn và đường truyền.

Phương án phù hợp khi có người phụ trách vận hành, chấp nhận bảo trì có lịch và có quy trình khôi phục. Một máy vẫn là điểm hỏng duy nhất: Docker không tạo ra dự phòng phần cứng. Nếu nhiều địa điểm cần làm việc liên tục và không có người vận hành, nên ưu tiên VPS trả phí hoặc backend/database được quản lý thay vì chọn máy tại xưởng chỉ vì muốn bỏ phí dịch vụ.

## 2. Những gì đã xác định từ repository

| Thành phần | Bằng chứng | Ý nghĩa chuyển đổi |
|---|---|---|
| Frontend React 18/Vite 5 | `package.json`, `vite.config.js` | Build thành tệp tĩnh; phục vụ bằng Caddy hoặc Nginx, không chạy Vite dev server ở production |
| API Node.js/Express | `backend/server.js`, `backend/package.json` | Đóng thành container Linux; hiện lắng nghe cổng 4000 |
| PostgreSQL trực tiếp qua `pg` | `backend/src/core/db.js` | Có thể chuyển Supabase DB sang PostgreSQL riêng |
| Pool 10 kết nối, timeout lấy kết nối 10 giây | `backend/src/core/db.js` | 20 người không cần 20 kết nối DB thường trực; giữ 10 trước, đo rồi chỉnh |
| JWT và kiểm tra quyền phía server | `backend/src/modules/auth/authController.js`, `backend/src/core/requireAuth.js`, các route | Không cần chuyển tài khoản sang Supabase Auth |
| Tệp đính kèm nằm trong DB dạng base64 | `productController.js`, bảng `product_attachments.data` | Dump DB hiện mang theo các tệp này; cần tính dung lượng và thời gian backup |
| URL backend có ở hai chỗ | `src/mesApi.js:2`, `MesApp.jsx:59` | Cả hai dùng `VITE_API_BASE`, mặc định trỏ Render |
| Schema dump ghi PostgreSQL 17.10; có `pgcrypto` | `backend/migrations/schema_consolidated.sql` | Xác minh phiên bản DB thật; giai đoạn đầu giữ cùng major để giảm biến số |
| Migration chạy chủ động | `backend/scripts/migrate.js`, `docs/DEPLOY.md` | Có khối sửa dữ liệu lịch sử; không tự chạy mỗi lần container khởi động |
| `/health` chỉ trả `{ok:true}` | `backend/server.js` | Chưa xác nhận DB hoạt động; cần thêm readiness có truy vấn DB |
| Chưa có Dockerfile/Compose trong mã được rà soát | Repository hiện tại | Cần tạo bộ triển khai, chưa có sẵn để chỉ chạy một lệnh |

Không thấy mã ứng dụng đang gọi Supabase Auth, Storage hay Realtime trong phần đã kiểm tra, dù package Supabase có trong dependency frontend. Trước chuyển vẫn phải kiểm kê project Supabase thật để phát hiện bucket, tác vụ, extension hoặc hệ thống khác ngoài repository.

README/ARCHITECTURE có mô tả cũ, như token trong bộ nhớ và phân quyền chỉ ở client. Kế hoạch này dựa trên mã hiện hành và `docs/DEPLOY.md`.

Chưa truy cập dashboard Vercel/Render/Supabase, chưa đo DB production, chưa chạy thử tải hoặc restore. Các công việc đó là đầu vào của giai đoạn 1.

## 3. Server riêng giải quyết được gì?

| Vấn đề | Tác dụng | Phần còn phải làm |
|---|---|---|
| Render Free ngủ và khởi động lại khi có request | API trên máy luôn bật không chịu cơ chế ngủ của Render | Theo dõi tiến trình, lỗi DB, bộ nhớ, tự khởi động sau mất điện |
| Giới hạn dung lượng Supabase Free | PostgreSQL riêng dùng dung lượng ổ đã cấp | Dành chỗ cho index, WAL, file tạm, backup; cảnh báo đầy ổ |
| Độ trễ API–DB qua Internet | API và DB cùng máy trao đổi qua mạng Docker | Truy vấn chậm vẫn cần phân tích, không tự hết khi chuyển máy |
| Dùng tại xưởng khi mất Internet | Có thể tiếp tục qua đường LAN trực tiếp | Phải có DNS nội bộ, HTTPS nội bộ hợp lệ và frontend chạy tại máy |
| Dùng từ xa | Có thể qua domain và tunnel | Phụ thuộc điện, uplink, router và tunnel tại nơi đặt máy |
| Tăng từ 3 lên 20 người | Cấu hình đề xuất có cơ sở để thử nghiệm | Kiểm thử thao tác đồng thời, báo cáo và import trên dữ liệu đại diện |

Theo tài liệu được kiểm tra ngày lập kế hoạch, Render Free ngủ sau 15 phút không có lưu lượng vào và có thể mất khoảng một phút để lên lại. Supabase Free có giới hạn database 500 MB; phần Storage là hạn mức khác. Ảnh base64 đang lưu trong bảng sẽ chiếm dung lượng database của ứng dụng này. [Render](https://render.com/docs/free), [Supabase](https://supabase.com/pricing).

## 4. Phần cứng và hệ điều hành

| Hạng mục | Mức khởi đầu có thể dùng | Mức khuyến nghị khi mua |
|---|---|---|
| CPU | Core i5-10400/10500 | i5-10500/10600; i7-10700 nếu chạy thêm dịch vụ |
| RAM | 16 GB cho riêng ứng dụng, cần đo tải | 32 GB, 2 thanh 16 GB DDR4 UDIMM tương thích |
| Ổ chạy OS, Docker, PostgreSQL | SSD NVMe 500/512 GB còn tốt | NVMe TLC 1 TB mới, hãng có bảo hành, có thông số độ bền ghi |
| Ổ sao lưu cục bộ | Một thiết bị lưu trữ khác ổ chạy | 1–2 TB riêng; tăng dung lượng theo retention và số liệu thực |
| Sao lưu ngoài máy | Bắt buộc có một đích độc lập | NAS/ổ luân phiên cất nơi khác hoặc kho cloud có mã hóa |
| Mạng | Ethernet Gigabit | Dây Cat5e/Cat6, switch Gigabit; máy chủ cắm dây |
| UPS | Đủ công suất thực cho máy và thiết bị mạng | Tham khảo 1000–1500 VA, chọn theo W và biểu đồ runtime; có USB tắt máy an toàn |
| Nơi đặt | Thoáng, khô, hạn chế bụi | Khu vực có kiểm soát, tránh bụi/nhiệt của xưởng |

Thông số Dell: bản Tower dùng CPU Intel thế hệ 10, có 4 khe DDR4, tối đa 128 GB; i5 trong tài liệu có 6 nhân/12 luồng, i7-10700 có 8 nhân/16 luồng. RAM i5 thường chạy 2666 MHz, i7/i9 tới 2933 MHz theo cấu hình. Đây là khả năng của model, không phải cấu hình mọi máy cũ đang bán. [Hướng dẫn Dell, trang 14–20](https://www.bhphotovideo.com/lit_files/661192.pdf).

Trước mua máy cũ: kiểm Service Tag và đúng vỏ MT/Tower; chạy Dell Diagnostics, kiểm RAM, nhiệt, nguồn/quạt, SMART và lượng ghi SSD. Kiểm tra khay ổ, cáp SATA/cáp nguồn và khe M.2 thực tế trước khi đặt ổ bổ sung. Ưu tiên SSD tốt, UPS và backup trước việc nâng i5 lên i7. Không cần nguồn công suất cao hay GPU để chạy MES.

Có thể bổ sung hai SSD mirror nếu cần giảm thời gian gián đoạn do hỏng một ổ. Mirror/RAID không thay cho backup vì vẫn phản chiếu xóa nhầm và dữ liệu hỏng. Không bật RAID BIOS theo thói quen mà chưa chốt thiết kế Linux và cách phục hồi.

Hệ điều hành đề xuất: **Ubuntu Server 24.04 LTS 64-bit cài trực tiếp**, Docker Engine và Compose plugin từ nguồn chính thức. Bản này còn bảo trì tiêu chuẩn tới tháng 5/2029; 26.04 LTS tới tháng 5/2031 cũng là lựa chọn khi đã kiểm tra driver và vận hành. Chọn một bản để chuẩn hóa. [Ubuntu](https://ubuntu.com/about/release-cycle), [Docker](https://docs.docker.com/engine/install/ubuntu/).

Với stack hiện tại, không có nhu cầu kỹ thuật bắt buộc phải mua Windows Server. Dùng máy chuyên chạy MES, tắt sleep/hibernate và đặt BIOS tự bật lại khi có điện; kiểm tra thực tế các thiết lập này.

## 5. Kiến trúc cho cả tại xưởng và từ xa

```text
Người ngoài xưởng -> HTTPS / domain -> Cloudflare Tunnel -> web/proxy
Người trong xưởng -> DNS nội bộ / HTTPS -----------------> web/proxy
                                                         |
                                    +--------------------+----------------+
                                    |                                     |
                                frontend dist                         /api/*
                                                                          |
                                                                      API Node
                                                                          |
                                                                   PostgreSQL
                                                                          |
                                                      backup -> đích ngoài máy
```

Các service Compose dự kiến: `web` (Caddy phục vụ frontend và reverse proxy), `api`, `db`, `cloudflared`. Tác vụ backup có lịch trên host hoặc service riêng. Giai đoạn này chưa cần Kubernetes, Redis hay toàn bộ bộ dịch vụ Supabase.

Một tên miền riêng, ví dụ `mes.<ten-mien-cong-ty>`, dùng chung frontend và `/api`. Proxy phải giữ nguyên tiền tố `/api` vì backend đang mount route theo đường dẫn đó. Chuyển `/health` và readiness tới API, tránh SPA fallback trả HTML thay cho API.

Truy cập từ xa: dùng named tunnel ổn định qua Cloudflare; không dùng URL quick tunnel tạm thời. Tunnel kết nối từ trong ra ngoài nên không cần public IP hay mở cổng vào router, phù hợp khi nhà mạng dùng CGNAT. Tunnel vẫn phụ thuộc Internet tại server và không tự thay cho đăng nhập/phân quyền ứng dụng. [Cloudflare](https://developers.cloudflare.com/tunnel/).

Quản trị SSH chỉ qua LAN/VPN quản trị. Không công khai PostgreSQL 5432, API 4000 hay Docker socket. Không cache API có xác thực tại CDN; chỉ cache asset tĩnh có tên chứa hash.

Ở xưởng, cấu hình DNS nội bộ trả IP LAN của cùng domain; Caddy có chứng chỉ HTTPS hợp lệ tại LAN. Có thể cấp chứng chỉ bằng DNS-01; cần Caddy có module DNS provider tương ứng và lưu chứng chỉ bền vững. HTTPS tại Cloudflare không tự cung cấp HTTPS cho đường truy cập LAN trực tiếp.

Kiểm tra trình duyệt có Secure DNS/DoH hoặc DNS cache bỏ qua DNS nội bộ. Có quy trình truy cập LAN dự phòng đã thử trên máy và điện thoại thật. Google Fonts đang được import trong `src/index.css`; nên tự lưu font hoặc kiểm chứng font dự phòng để mất Internet không ảnh hưởng cách dùng thiết yếu. Đây là truy cập LAN tới server, không phải ứng dụng offline khi thiết bị rời mạng xưởng.

Đường truyền: đo upload tại nơi đặt máy ở giờ cao điểm; khởi đầu cân nhắc uplink ổn định khoảng 30–50 Mbps cho nghiệp vụ nhẹ, sau đó quyết định bằng thử tải thật. Đây là mức dự trù, không phải cam kết băng thông cho mọi bộ dữ liệu. Báo cáo lớn, ảnh và backup ngoài máy có thể làm nghẽn upload. Nếu truy cập từ xa quan trọng, dùng router có failover 4G/5G và thử chuyển mạng thật. UPS cấp cả ONT/router/switch cần thiết. Người ở xa không dùng được khi mọi đường Internet của server đều mất.

## 6. Các thay đổi kỹ thuật cần làm

1. Tạo Dockerfile backend chạy Node.js LTS đã kiểm tra dependency (đề xuất thử Node 24), `npm ci --omit=dev`, user không phải root; khóa image theo phiên bản/digest trong lần phát hành. README yêu cầu Node 18+ đã cũ, không lấy đó làm runtime production. [Node.js](https://nodejs.org/en/about/previous-releases).
2. Tạo build frontend nhiều giai đoạn, phục vụ `dist`; thêm SPA fallback và giới hạn upload phù hợp ở proxy.
3. Tạo Compose, `.dockerignore`, cấu hình web/proxy, mẫu biến môi trường không chứa bí mật và hướng dẫn backup/restore.
4. DB lưu bằng volume/bind mount bền vững trên SSD; không nằm trong lớp ghi tạm của container. Chốt quyền sở hữu thư mục, dung lượng và nơi mount. Không dùng thao tác xóa volume trong quy trình cập nhật.
5. Ban đầu giữ PostgreSQL major 17 nếu DB thật cũng là 17; lấy bản vá được hỗ trợ và kiểm tra tương thích. Không dùng tag `latest` cho DB hoặc gộp nâng major với chuyển hạ tầng.
6. Cấu hình backend dùng `PGHOST=db`, `PGPORT=5432`, `PGDATABASE=mes`, tài khoản ứng dụng và mật khẩu riêng. **Bỏ biến `DATABASE_URL` cũ**: nhánh này đang ưu tiên URL và ép SSL, nên URL trỏ PostgreSQL nội bộ không có TLS sẽ không phù hợp. Cả runtime và script migrate đều có logic này.
7. Đặt `NODE_ENV=production`, `JWT_SECRET` mạnh, `CORS_ORIGINS` theo domain mới, `PORT=4000`. Giữ JWT secret cũ nếu cần giữ phiên; nếu chủ động đổi thì thông báo mọi người đăng nhập lại. Bí mật không đưa vào Git, frontend hay Docker build arg.
8. `TRUST_PROXY` phải khớp đường proxy thật cho cả LAN và tunnel. Kiểm tra IP thực và việc giả header; không đặt `true` tùy tiện. Rate limit hiện theo IP, cần thử cả xưởng đăng nhập đầu ca và dùng đồng thời để tránh 429 ngoài ý muốn.
9. Build với `VITE_API_BASE=https://<domain-moi>`: biến Vite được nhúng lúc build, đổi env container web sau build không có tác dụng. Hiện dùng `||` ở cả hai nơi, nên đặt chuỗi rỗng vẫn quay về Render. Nếu muốn API tương đối cùng origin thì sửa thống nhất cả hai nơi trước.
10. Thêm readiness kiểm tra DB, xử lý lỗi pool và shutdown kết nối êm khi nhận SIGTERM. Docker restart policy xử lý tiến trình thoát; healthcheck báo unhealthy không tự bảo đảm container được restart.
11. Không thêm `npm run migrate` vào lệnh khởi động. Tách migration thành bước phát hành có backup, nhật ký và kiểm chứng trên bản sao; hướng tới migration có phiên bản, chỉ áp một lần.
12. Kiểm tra tài khoản admin mặc định trong quy trình khởi tạo; bảo đảm đã đổi mật khẩu trước mở truy cập từ xa. Tách tài khoản quản trị DB và tài khoản ứng dụng; thử đủ quyền cho các nghiệp vụ, không chạy API bằng superuser.
13. Không publish cổng DB trong Compose; Docker có thể vượt qua một số quy tắc UFW khi publish port, nên phải kiểm tra cổng từ một thiết bị khác. [Docker firewall](https://docs.docker.com/engine/install/ubuntu/).

## 7. Kế hoạch chuyển đổi theo giai đoạn

Thời gian dưới đây là ước lượng công triển khai, chưa gồm mua máy, chờ nhà mạng hoặc lỗi dữ liệu phát hiện khi thử nghiệm.

### Giai đoạn 1 — Đo hiện trạng và chốt điều kiện vận hành (0,5–1 ngày)

- Ghi phiên bản DB thật, dung lượng DB/index, bảng lớn nhất, số tệp đính kèm, tăng trưởng mỗi tuần, số chứng từ/ngày và số người đồng thời.
- Đo API khi Render đã lên và ngay sau thời gian nhàn rỗi; tách cold start, độ trễ mạng và SQL chậm. Kiểm tra log nếu người dùng đang phải restart thủ công.
- Kiểm kê Supabase extension, schema ngoài `public`, role/grant, bucket, job và ứng dụng khác dùng cùng DB; không giả định repo phản ánh tất cả.
- Kiểm kê URL API trong frontend, app mobile nếu có, bookmark/QR chứa URL, tích hợp và lịch backup hiện hành.
- Ghi baseline để đối chiếu: số bản ghi theo bảng, tổng tồn theo kho/sản phẩm/đơn vị, số lệnh SX, phiếu giao và công nợ. Đối chiếu số liệu trên cùng snapshot hoặc sau khi đã dừng ghi.
- Chốt người vận hành, thời gian bảo trì, người có quyền khôi phục và mức mất dữ liệu chấp nhận được.

SQL chỉ đọc để người quản trị đo, không phải thao tác đã thực hiện:

```sql
SELECT version();
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
SELECT schemaname, relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;
```

Đầu ra: baseline, BOM mua sắm, quyết định self-host/VPS, thiết kế mạng và mục tiêu phục hồi có người chịu trách nhiệm.

### Giai đoạn 2 — Chuẩn bị máy và bộ Docker (1–2 ngày)

- Kiểm phần cứng; cài Ubuntu, cập nhật, NTP, SSH key, firewall và IP LAN cố định/DHCP reservation.
- Dựng stack thử nghiệm; chưa đưa người dùng production vào.
- Chuẩn bị domain/tunnel, DNS nội bộ, HTTPS, router dự phòng, UPS và cơ chế tự bật sau mất điện.
- Lưu code/image phát hành, cấu hình mẫu và bí mật vào nơi quản lý phù hợp; bảo đảm có thể dựng lại khi mất máy.

Đầu ra: hệ thống thử nghiệm lên lại được sau reboot, DB còn dữ liệu, truy cập được qua LAN và 4G.

### Giai đoạn 3 — Chuyển bản sao dữ liệu và diễn tập (1–2 ngày)

- Tạo logical dump DB hiện tại bằng `pg_dump` phù hợp phiên bản nguồn; dùng kết nối direct hoặc session phù hợp tác vụ quản trị, tránh transaction pooler. Dùng tệp credential/service được bảo vệ, không đặt mật khẩu vào command history hay tài liệu.
- Với ứng dụng chỉ phụ thuộc `public`, chuẩn bị dump custom-format của schema nghiệp vụ gồm schema + data + sequence/function/trigger. Kiểm tra phụ thuộc extension/schema khác trước: dump giới hạn schema không tự mang đủ mọi phụ thuộc. Không sao chép mù toàn bộ role/schema quản trị của Supabase sang PostgreSQL thường. [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).
- Restore vào database thử nghiệm sạch bằng `pg_restore`, xử lý owner/grant theo tài khoản mới, tạo extension ở schema đúng và dừng khi có lỗi. Không nạp schema từ repo trước rồi restore schema trùng lên đó. Recipe chính xác được chốt sau lần diễn tập thành công.
- Kiểm tra sequence, trigger, function, constraint, index và schema thu hồi JWT. Xem riêng các migration thực sự thiếu; không mặc định replay mọi sửa dữ liệu trong POST-MIGRATION.
- Chạy ANALYZE; so baseline nghiệp vụ, số bản ghi và hash/mẫu tệp đính kèm. Mật khẩu người dùng được giữ nguyên dưới dạng hash trong bảng users.
- Chạy thử toàn bộ luồng: đơn hàng → kế hoạch → LSX → xuất NVL → ghi nhận sản lượng → tồn kho → giao hàng → thanh toán/công nợ, thêm import/export và phân quyền.
- Khôi phục lại từ backup mới của server thử sang một DB khác; đo thời gian thực tế để có bằng chứng có thể cứu dữ liệu.

Đầu ra: runbook dump/restore đã thử, biên bản đối chiếu và thời gian downtime dự kiến từ số đo thực.

### Giai đoạn 4 — Thử tải, mạng và sự cố (1–2 ngày)

- Mô phỏng 20 phiên đồng thời với nhịp thao tác thực: xem danh sách, tìm kiếm, tạo/sửa chứng từ, ghi nhận sản lượng và mở dashboard; chạy liên tục ít nhất 60 phút.
- Trên DB thử: nhiều người cùng hoàn thành một LSX, xuất cùng lô hoặc cấp mã chứng từ. Kiểm tra không trùng mã, không ghi kho hai lần, không làm sai tồn hoặc công nợ. Mã hiện có khóa ở nhiều luồng nhưng vẫn cần kiểm thử xuyên suốt.
- Thử 20 người đăng nhập đầu ca; thêm một import/báo cáo nặng đồng thời để tìm ảnh hưởng tới người còn lại. Không chạy các bài ghi dữ liệu này trên production.
- Mục tiêu nghiệm thu đề xuất: API nghiệp vụ thông thường p95 dưới 1 giây trong LAN, dưới 2 giây qua 4G có tín hiệu ổn định; không có 5xx/429 ngoài dự kiến và không sai số liệu. Màn hình có thể gọi nhiều API nên đo thêm thời gian hiển thị. Chốt ngưỡng báo cáo/import riêng theo kích thước dữ liệu.
- Theo dõi CPU, RAM, swap, disk I/O, pool waiting, truy vấn chậm, lock, dung lượng DB/WAL và upload. CPU kéo dài trên khoảng 70–80%, thiếu RAM hoặc swap tăng là tín hiệu cần điều tra, không tự động kết luận phải mua CPU mới.
- Thử mất WAN nhưng LAN còn, chuyển WAN sang 4G, restart API/DB/host, tắt máy an toàn bằng UPS và phục hồi nguồn. Kiểm tra lại dữ liệu sau mỗi tình huống.

Đầu ra: kết quả tải và sự cố đạt yêu cầu trước khi chuyển chính thức.

### Giai đoạn 5 — Chuyển chính thức ngoài giờ (dự trù cửa sổ 1–2 giờ, điều chỉnh sau diễn tập)

1. Thông báo thời gian bảo trì; chốt bản code/image và danh sách người phụ trách.
2. **Dừng mọi nguồn ghi vào DB cũ**, gồm API Render, mobile/tích hợp/script nếu có. Trang thông báo bảo trì không đủ nếu API vẫn nhận ghi.
3. Tạo bản dump cuối sau khi dừng ghi, kiểm tra checksum và lưu một bản ngoài máy.
4. Restore sang DB production mới sạch theo đúng runbook đã thử. Không để thao tác thử trước đó lẫn vào DB mới.
5. Kiểm baseline, đăng nhập, tồn kho, công nợ, tệp đính kèm, quyền và trạng thái API/DB. Chỉ mở ghi khi đạt đối chiếu.
6. Chuyển domain và các client sang hệ thống mới. Nếu người dùng còn vào URL Vercel cũ, cập nhật trang đó sang thông báo/chuyển hướng có hướng dẫn để tránh họ dùng endpoint cũ.
7. Giữ API cũ ngừng ghi. Ghi mốc bắt đầu nhận giao dịch mới; từ mốc này server mới là nguồn dữ liệu chính duy nhất.
8. Theo dõi sát các ngày đầu. Sau 7–14 ngày ổn định và đã restore thử backup server mới, mới dọn dịch vụ cũ; giữ bản lưu cuối theo chính sách lưu trữ.

Không hứa downtime chính xác trước khi đo restore. 1–2 giờ là cửa sổ dự trù cho DB nhỏ, không phải cam kết.

### Giai đoạn 6 — Vận hành ổn định

- Chỉ một DB production có quyền nhận ghi. Không dùng hai DB độc lập như hai nơi để người dùng tự chọn.
- Phát hành: backup → xác minh bản phát hành → migration cần thiết → cập nhật container → kiểm nghiệp vụ. Chỉ build lại frontend khi thay code/env build tương ứng.
- Lưu image phiên bản trước để quay lại code; thay đổi schema/dữ liệu phải có phương án riêng.
- Hàng tuần xem cảnh báo, dung lượng, backup và truy vấn chậm; hàng tháng vá theo lịch, kiểm UPS và diễn tập restore. Chỉ cập nhật image sau khi thử, không tự kéo `latest` lên production.

## 8. Backup, phục hồi và rollback

Mục tiêu đề xuất cần được xác nhận bằng diễn tập:

- **RPO tối đa 1 giờ**: có thể mất tối đa một giờ giao dịch nếu hỏng hệ thống. Với DB còn nhỏ, bắt đầu logical backup mỗi giờ và đẩy bản thành công ra đích ngoài máy; theo dõi độ trễ để biết tuổi bản sao thực tế. Nếu không chấp nhận mức mất này hoặc full dump tạo tải cao, dùng base backup + lưu WAL ngoài máy để phục hồi theo thời điểm.
- **RTO 2–4 giờ** chỉ khả thi khi có host thay thế/VPS đã chuẩn bị, backup truy cập được và quy trình đã đo. Nếu phải chờ mua nguồn/main/ổ thay thế, thời gian gián đoạn có thể dài hơn nhiều. Một OptiPlex duy nhất không đảm bảo mục tiêu này.
- Retention khởi đầu: 24 bản theo giờ, 14 bản theo ngày, 8 bản theo tuần; điều chỉnh theo kích thước dump, tốc độ tăng và dung lượng nơi lưu. Backup bao gồm DB, file nếu sau này tách ngoài DB, cấu hình deploy, chứng chỉ và bí mật được mã hóa riêng.
- Mô hình 3-2-1: dữ liệu đang chạy, bản cục bộ khác ổ, bản ngoài máy/ngoài địa điểm. Ổ thứ hai cùng thùng máy chỉ là lớp tiện khôi phục, chưa bảo vệ khỏi mất máy/cháy/nhiễm mã độc.
- Cảnh báo backup lỗi, quá hạn hoặc bản offsite quá cũ. Restore định kỳ và đối chiếu nghiệp vụ; chỉ có file backup chưa chứng minh phục hồi được.

Rollback khi chuyển:

| Thời điểm | Cách xử lý |
|---|---|
| Chưa mở ghi ở server mới | Dừng hệ thống mới, đưa domain/client về cũ và mở lại nguồn cũ sau kiểm tra |
| Server mới đã nhận giao dịch | Dừng ghi mới, chụp backup; ưu tiên sửa tiến để giữ giao dịch. Nếu quay lại hạ tầng cũ, chuyển dữ liệu mới nhất về nơi nhận tương thích và đối chiếu trước khi mở ghi |
| Chỉ lỗi bản code mới | Quay lại image cũ nếu tương thích schema hiện tại; không phục hồi DB cũ một cách tự động |

Không đơn giản trỏ DNS về DB cũ sau khi đã phát sinh giao dịch tại DB mới: làm vậy sẽ bỏ mất giao dịch hoặc tách đôi dữ liệu.

## 9. Dữ liệu lớn và chi phí lâu dài

32 GB RAM không đồng nghĩa chỉ chứa được 32 GB DB. PostgreSQL có thể lưu dữ liệu lớn hơn RAM, còn tốc độ phụ thuộc tập dữ liệu thường truy cập, index và I/O. SSD 1 TB cũng không được cấp toàn bộ cho bảng nghiệp vụ: OS, image, WAL, index, file tạm và khoảng trống bảo trì cùng dùng ổ.

Theo dõi tăng trưởng thực tế mỗi tuần; cảnh báo sơ bộ ở 70% dung lượng và xử lý trước 80%. Dự trù dung lượng theo `dữ liệu hiện tại + tăng trưởng dự kiến + index/WAL/file tạm + khoảng trống vận hành`; backup ngoài ổ có công thức riêng.

Ảnh base64 dài hơn dữ liệu nhị phân khoảng 33% trước ảnh hưởng nén của PostgreSQL. Không suy ra kích thước đĩa chính xác chỉ bằng hệ số đó. Nếu ảnh/tài liệu chiếm phần lớn DB, sau khi chuyển ổn định hãy tách sang volume lưu file hoặc object storage, DB giữ metadata; backup file và DB phải nhất quán. Không cần thêm MinIO chỉ vì dùng Docker.

Backend đã có phân trang ở generic CRUD nhưng một số màn hình còn phân trang trên trình duyệt; cần kiểm từng API/màn hình trên dữ liệu lớn. Với dashboard/báo cáo, dùng log và EXPLAIN để tìm truy vấn chậm; bổ sung index, lọc theo ngày, phân trang phía server và giới hạn import theo kết quả đo. Giữ pool 10 trước khi có bằng chứng cần tăng, không mặc định phải thêm PgBouncer cho 20 người.

Tổng chi phí server riêng gồm máy + SSD + UPS + backup + domain + điện + Internet dự phòng + công vận hành/phục hồi. Ví dụ tính điện: nếu đo được trung bình 60 W và chạy 24/7 thì khoảng 43,2 kWh mỗi 30 ngày, chưa tính thiết bị mạng; đây là ví dụ công thức, không phải số đo của OptiPlex.

| Phương án | Khi phù hợp | Chi phí/điều kiện chính |
|---|---|---|
| OptiPlex tại xưởng | Muốn chủ động dữ liệu và cần LAN hoạt động khi mất WAN | Đầu tư phần cứng, mạng dự phòng và tự vận hành |
| VPS trả phí chạy Docker | Nhiều người dùng từ xa, ít muốn bảo trì máy vật lý | Thuê hàng tháng; vẫn cần tự quản trị DB và backup nếu tự host DB |
| Backend và DB dịch vụ trả phí | Muốn giảm việc vận hành | Phí dịch vụ; chọn đúng gói không ngủ và đủ dung lượng/backup |

Không có cơ sở khẳng định mua máy rẻ hơn trước khi có báo giá máy/SSD/UPS, yêu cầu uptime và giá trị thời gian vận hành. Với việc dùng từ xa thường xuyên, nên so tổng chi phí 2–3 năm với VPS trước khi mua.

## 10. Điều kiện hoàn tất chuyển đổi

- [ ] Kiểm tải 20 phiên và các luồng cập nhật đồng thời đạt yêu cầu.
- [ ] Đối chiếu số liệu và tệp đính kèm sau restore không sai lệch.
- [ ] Chỉ một DB nhận ghi; mọi client đã đổi endpoint.
- [ ] LAN và từ xa dùng HTTPS hợp lệ; thử mất WAN và WAN dự phòng thành công.
- [ ] Reboot/mất điện có kiểm soát không mất dữ liệu; UPS tắt máy đúng.
- [ ] Có backup ngoài máy, cảnh báo lỗi và một lần restore đã đo thời gian.
- [ ] Có người phụ trách, host phục hồi và runbook rollback phù hợp giao dịch mới.
- [ ] Tài khoản, bí mật, cổng mạng và quyền DB đã kiểm trên cấu hình thực tế.

Đề xuất quyết định: triển khai thử OptiPlex theo cấu hình 32 GB/1 TB, chỉ chuyển production sau khi diễn tập đạt các điều kiện trên. Nếu không thể bố trí Internet dự phòng, người vận hành hoặc host khôi phục, chuyển cùng bộ Docker sang VPS là lựa chọn thực tế hơn cho nhóm thường xuyên làm việc từ xa.
