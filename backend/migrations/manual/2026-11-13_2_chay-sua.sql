-- 2026-11-13 · Kế hoạch chuyển kỳ — SỬA (chạy sau khi xem file _1). CHỈ cho DB máy dev đã chạy bản đầu mục 37.
-- Khôi phục updated_at gốc + đặt ngày hoàn thành / hủy theo ước lượng công đoạn. Chạy lại: không còn dòng khớp → không đổi gì.
BEGIN;
ALTER TABLE production_orders DISABLE TRIGGER trg_production_orders_updated;
UPDATE production_orders po SET
    updated_at   = COALESCE(po.completed_at, po.cancelled_at),
    completed_at = CASE WHEN po.status = 'Hoàn thành' THEN COALESCE((SELECT MAX(t.updated_at) FROM production_tasks t
                     WHERE t.production_order_id = po.id AND t.status = 'Hoàn thành'), po.created_at) END,
    cancelled_at = CASE WHEN po.status = 'Đã hủy' THEN COALESCE((SELECT MAX(t.updated_at) FROM production_tasks t
                     WHERE t.production_order_id = po.id), po.created_at) END
  WHERE po.status IN ('Hoàn thành', 'Đã hủy')
    AND po.updated_at >= '2026-11-13 11:09:43+07' AND po.updated_at < '2026-11-13 11:09:44+07';
ALTER TABLE production_orders ENABLE TRIGGER trg_production_orders_updated;
COMMIT;
