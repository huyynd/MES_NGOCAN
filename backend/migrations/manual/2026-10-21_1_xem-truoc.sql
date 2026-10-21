-- =====================================================================
-- XEM TRƯỚC (CHỈ ĐỌC — không sửa gì): lệnh SX lệch thông số với dòng đơn hàng
-- Chạy trên PRD: Supabase → SQL Editor → dán toàn bộ file → Run.
-- Kết quả: mỗi dòng 1 lệnh SX sẽ được sửa, kèm thông số hiện tại / thông số đúng (theo đơn)
-- và số dòng tồn, số kg tồn đang mang thông số sai.
-- =====================================================================
WITH m AS (
  SELECT po.id AS po_id, po.order_code AS lot, po.status, po.spec_key AS lsx_hien_tai, it.spec_key AS dung_theo_don
    FROM public.production_orders po
    JOIN public.sales_order_items it ON it.id = po.sales_order_item_id
   WHERE po.is_deleted = FALSE AND po.order_code IS NOT NULL
     AND COALESCE(NULLIF(it.spec_key, ''), '||||') <> '||||'
)
SELECT m.lot AS lenh_sx, m.status AS trang_thai, m.lsx_hien_tai, m.dung_theo_don,
       (SELECT count(*) FROM public.inventory_stock s WHERE s.lot_code = m.lot AND s.spec_key <> m.dung_theo_don) AS dong_ton_sai,
       (SELECT COALESCE(SUM(s.quantity), 0) FROM public.inventory_stock s WHERE s.lot_code = m.lot AND s.spec_key <> m.dung_theo_don) AS kg_ton_sai
  FROM m
 WHERE m.lsx_hien_tai IS DISTINCT FROM m.dung_theo_don
    OR EXISTS (SELECT 1 FROM public.inventory_stock s WHERE s.lot_code = m.lot AND s.spec_key <> m.dung_theo_don)
 ORDER BY m.lot;
