-- =====================================================================
-- SỬA DỮ LIỆU PRD: đồng bộ thông số Lệnh SX theo dòng đơn hàng (lỗi form "Rộng × Dài", 2026-10-21)
-- Giống hệt migration mục 23 trong schema_consolidated.sql — chạy file này HOẶC `npm run migrate`, không cần cả hai
-- (chạy cả hai / chạy lại nhiều lần cũng không sao: lần sau không còn gì để sửa).
--
-- Cách chạy: Supabase → SQL Editor → dán toàn bộ file → Run.
--   • Tất cả nằm trong 1 giao dịch: lỗi ở bất kỳ bước nào → không thay đổi gì.
--   • Tự kiểm: tổng tồn kho trước/sau phải bằng nhau, nếu khác → tự hủy toàn bộ (báo lỗi "TỔNG TỒN THAY ĐỔI").
--   • Cuối cùng in bảng kết quả (trước / sau).
-- Nên sao lưu PRD trước khi chạy (Supabase → Database → Backups).
--
-- QUAN TRỌNG: phải đưa CODE mới lên PRD (form Lệnh SX 5 thông số + kế thừa từ đơn). Nếu chỉ sửa dữ liệu mà code cũ
-- vẫn chạy, lần "Sửa / Lưu" lệnh SX kế tiếp sẽ làm lệch lại.
-- =====================================================================
BEGIN;

CREATE TEMP TABLE _bao_cao ON COMMIT DROP AS
SELECT 'Trước'::text AS luc,
       (SELECT count(*) FROM public.production_orders po JOIN public.sales_order_items it ON it.id = po.sales_order_item_id
         WHERE po.is_deleted = FALSE AND po.spec_key IS DISTINCT FROM it.spec_key
           AND COALESCE(NULLIF(it.spec_key, ''), '||||') <> '||||') AS lenh_sx_lech,
       (SELECT count(*) FROM public.inventory_stock) AS so_dong_ton,
       (SELECT COALESCE(SUM(quantity), 0) FROM public.inventory_stock) AS tong_ton;

CREATE TEMP VIEW _spec_fix_map AS
  SELECT po.id AS po_id, po.order_code AS lot, it.specs, it.spec_key,
         COALESCE(it.attr_size, '') AS attr_size, COALESCE(it.attr_thickness, '') AS attr_thickness, COALESCE(it.attr_color, '') AS attr_color
    FROM public.production_orders po
    JOIN public.sales_order_items it ON it.id = po.sales_order_item_id
   WHERE po.is_deleted = FALSE AND po.order_code IS NOT NULL
     AND COALESCE(NULLIF(it.spec_key, ''), '||||') <> '||||';

-- a) Tồn kho: tạo sẵn dòng đích (nếu chưa có) → cộng dồn → xóa dòng cũ
INSERT INTO public.inventory_stock
  (product_id, location_id, specs, spec_key, lot_code, prod_order_id, attr_size, attr_thickness, attr_color, quantity, unit, created_at)
SELECT s.product_id, s.location_id, (array_agg(m.specs))[1], m.spec_key, s.lot_code, (array_agg(m.po_id))[1],
       MAX(m.attr_size), MAX(m.attr_thickness), MAX(m.attr_color), 0, MAX(s.unit), MIN(s.created_at)
  FROM public.inventory_stock s JOIN _spec_fix_map m ON m.lot = s.lot_code
 WHERE s.spec_key <> m.spec_key
 GROUP BY s.product_id, s.location_id, s.lot_code, m.spec_key
ON CONFLICT (product_id, location_id, spec_key, lot_code) DO NOTHING;

UPDATE public.inventory_stock t
   SET quantity = t.quantity + agg.q, updated_at = now()
  FROM (SELECT s.product_id, s.location_id, s.lot_code, m.spec_key, SUM(s.quantity) AS q
          FROM public.inventory_stock s JOIN _spec_fix_map m ON m.lot = s.lot_code
         WHERE s.spec_key <> m.spec_key
         GROUP BY s.product_id, s.location_id, s.lot_code, m.spec_key) agg
 WHERE t.product_id = agg.product_id AND t.location_id IS NOT DISTINCT FROM agg.location_id
   AND t.lot_code = agg.lot_code AND t.spec_key = agg.spec_key;

DELETE FROM public.inventory_stock s USING _spec_fix_map m
 WHERE m.lot = s.lot_code AND s.spec_key <> m.spec_key;

-- b) Sổ cái + cuộn đã dùng + dòng phiếu xuất: đổi thông số theo lô
UPDATE public.inventory_transactions t
   SET spec_key = m.spec_key, specs = m.specs, attr_size = m.attr_size, attr_thickness = m.attr_thickness, attr_color = m.attr_color
  FROM _spec_fix_map m
 WHERE t.lot_code = m.lot AND t.spec_key <> m.spec_key;
UPDATE public.production_roll_usage u SET spec_key = m.spec_key, specs = m.specs
  FROM _spec_fix_map m WHERE u.lot_code = m.lot AND u.spec_key IS DISTINCT FROM m.spec_key;
UPDATE public.outbound_slip_lines l SET spec_key = m.spec_key
  FROM _spec_fix_map m WHERE l.lot_code = m.lot AND l.spec_key IS NOT NULL AND l.spec_key <> m.spec_key;

-- c) Chính lệnh SX
UPDATE public.production_orders po
   SET specs = m.specs, spec_key = m.spec_key, attr_size = m.attr_size, attr_thickness = m.attr_thickness,
       attr_color = m.attr_color, group_key = po.product_id::text || '||' || m.spec_key
  FROM _spec_fix_map m
 WHERE po.id = m.po_id AND po.spec_key IS DISTINCT FROM m.spec_key;

DROP VIEW _spec_fix_map;

INSERT INTO _bao_cao
SELECT 'Sau',
       (SELECT count(*) FROM public.production_orders po JOIN public.sales_order_items it ON it.id = po.sales_order_item_id
         WHERE po.is_deleted = FALSE AND po.spec_key IS DISTINCT FROM it.spec_key
           AND COALESCE(NULLIF(it.spec_key, ''), '||||') <> '||||'),
       (SELECT count(*) FROM public.inventory_stock),
       (SELECT COALESCE(SUM(quantity), 0) FROM public.inventory_stock);

-- Tự kiểm: tổng tồn phải giữ nguyên, không thì hủy toàn bộ
DO $$
DECLARE a numeric; b numeric;
BEGIN
  SELECT tong_ton INTO a FROM _bao_cao WHERE luc = 'Trước';
  SELECT tong_ton INTO b FROM _bao_cao WHERE luc = 'Sau';
  IF abs(a - b) > 0.001 THEN
    RAISE EXCEPTION 'TỔNG TỒN THAY ĐỔI (% → %) — đã hủy, không sửa gì.', a, b;
  END IF;
END $$;

SELECT * FROM _bao_cao ORDER BY luc DESC;  -- "Trước" rồi "Sau"

COMMIT;
