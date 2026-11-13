-- 2026-11-13 · Kế hoạch chuyển kỳ — XEM TRƯỚC (chỉ đọc). CHỈ cho DB máy dev đã chạy bản đầu mục 37 lúc 13/11 11:09.
-- Bản đầu: (1) điền completed_at/cancelled_at = updated_at cũ (sai: updated_at không phải ngày xong);
--          (2) trigger set_updated_at làm updated_at của các lệnh đó thành 13/11 11:09.
-- Liệt kê: updated_at sẽ trả về giá trị gốc; ngày hoàn thành / hủy sẽ đổi sang ước lượng theo công đoạn.
SELECT po.order_code, po.status, po.updated_at AS updated_hien_tai,
       COALESCE(po.completed_at, po.cancelled_at) AS updated_goc,
       CASE WHEN po.status = 'Hoàn thành' THEN COALESCE((SELECT MAX(t.updated_at) FROM production_tasks t
              WHERE t.production_order_id = po.id AND t.status = 'Hoàn thành'), po.created_at)
            ELSE COALESCE((SELECT MAX(t.updated_at) FROM production_tasks t WHERE t.production_order_id = po.id), po.created_at)
       END AS ngay_xong_huy_moi
FROM production_orders po
WHERE po.status IN ('Hoàn thành', 'Đã hủy')
  AND po.updated_at >= '2026-11-13 11:09:43+07' AND po.updated_at < '2026-11-13 11:09:44+07'
ORDER BY po.created_at;
