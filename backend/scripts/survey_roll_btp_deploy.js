// survey_roll_btp_deploy.js — RÀ SOÁT TRƯỚC DEPLOY tính năng cuộn BTP (CHỈ ĐỌC, không ghi gì).
// Mục tiêu: liệt kê các điểm cần xử lý tay trước khi bật logic mới (xem docs/ai/plans/2026-10-08-thiet-ke-cuon-btp.md §6).
// Chạy: cd backend && node scripts/survey_roll_btp_deploy.js   (nên chạy trên BẢN SAO PRD trước)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : { host: process.env.PGHOST || 'localhost', port: process.env.PGPORT || 5432,
      user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'mes' });

function printTable(title, rows, note) {
  console.log('\n' + '─'.repeat(70));
  console.log(`▶ ${title}  (${rows.length} dòng)`);
  if (note) console.log('  ' + note);
  console.log('─'.repeat(70));
  if (!rows.length) { console.log('  ✓ Không có — không cần xử lý.'); return; }
  console.table(rows);
}

(async () => {
  try {
    const roll = (await pool.query(`SELECT value FROM app_settings WHERE key='roll_product_id'`)).rows[0];
    console.log('Mã cuộn chung (roll_product_id):', roll ? String(roll.value) : 'CHƯA CẤU HÌNH ⚠');

    // 1) Lệnh Thổi đã xong nhưng CHƯA cắt xong, sản phẩm là Thành phẩm (bao bì).
    //    Cuộn của chúng có thể đang nằm ở BTP dưới MÃ BAO BÌ (logic cũ) → sau deploy Cắt sẽ không tìm thấy (Cắt tìm SP-PE-TC).
    const q1 = (await pool.query(`
      SELECT po.order_code, p.product_code, p.product_name, po.status AS order_status,
             COUNT(*) FILTER (WHERE t.stage='Thổi' AND t.status='Hoàn thành') AS thoi_done,
             COUNT(*) FILTER (WHERE t.stage='Cắt'  AND t.status='Hoàn thành') AS cat_done,
             COUNT(*) FILTER (WHERE t.stage='Cắt') AS cat_total
      FROM production_orders po
      JOIN products p ON p.id = po.product_id
      JOIN production_tasks t ON t.production_order_id = po.id
      WHERE po.is_deleted = FALSE AND p.product_type = 'Thành phẩm'
      GROUP BY po.id, po.order_code, p.product_code, p.product_name, po.status
      HAVING COUNT(*) FILTER (WHERE t.stage='Thổi' AND t.status='Hoàn thành') > 0
         AND (COUNT(*) FILTER (WHERE t.stage='Cắt') = 0
              OR COUNT(*) FILTER (WHERE t.stage='Cắt' AND t.status='Hoàn thành') = 0)
      ORDER BY po.order_code`)).rows;
    printTable('1. Lệnh bao bì đã Thổi xong mà chưa Cắt', q1,
      'Xử lý: cắt nốt trước deploy, HOẶC kho điều chỉnh (xuất mã bao bì ở BTP, nhập SP-PE-TC cùng thông số & lô).');

    // 2) Dòng phân công 'Hoàn thành' nhưng posted_qty = 0 (chưa ghi kho theo logic cũ).
    //    Sau deploy logic mới sẽ KHÔNG tự ghi (khóa dòng đã hoàn thành) → cần xử lý từng trường hợp.
    const q2 = (await pool.query(`
      SELECT po.order_code, t.task_code, t.stage, t.actual_qty, t.posted_qty
      FROM production_tasks t
      JOIN production_orders po ON po.id = t.production_order_id AND po.is_deleted = FALSE
      WHERE t.status = 'Hoàn thành' AND COALESCE(t.posted_qty,0) = 0
      ORDER BY po.order_code, t.task_code`)).rows;
    printTable('2. Dòng Hoàn thành nhưng posted_qty = 0', q2,
      'Sau deploy không tự ghi kho. Kiểm tra tồn thực tế rồi điều chỉnh tay nếu cần.');

    // 3) Tồn ở kho BTP mang MÃ THÀNH PHẨM (bao bì) — lẽ ra cuộn phải là SP-PE-TC.
    const q3 = (await pool.query(`
      SELECT p.product_code, p.product_name, w.name AS warehouse, s.lot_code,
             s.spec_key, s.quantity, s.unit
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      JOIN locations l ON l.id = s.location_id
      JOIN warehouses w ON w.id = l.warehouse_id
      WHERE w.warehouse_type = 'BTP' AND p.product_type = 'Thành phẩm' AND s.quantity <> 0
      ORDER BY p.product_code, s.lot_code`)).rows;
    printTable('3. Tồn BTP mang mã Thành phẩm (cuộn dưới mã bao bì)', q3,
      'Nên chuyển về SP-PE-TC (cùng thông số & lô) để Cắt mới nhận diện được.');

    // 4) Tồn ÂM bất kỳ (bất thường — cần điều chỉnh).
    const q4 = (await pool.query(`
      SELECT p.product_code, p.product_name, w.name AS warehouse, s.lot_code, s.spec_key, s.quantity
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN locations l ON l.id = s.location_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      WHERE s.quantity < 0
      ORDER BY s.quantity`)).rows;
    printTable('4. Tồn ÂM (bất thường)', q4, 'Điều chỉnh kiểm kê trước khi deploy.');

    // 5) Tồn BTP nhóm "(không có thông số)" — spec_key rỗng (plan nhắc ~189 kg cần điều chỉnh sau deploy).
    const q5 = (await pool.query(`
      SELECT p.product_code, p.product_name, s.lot_code, s.quantity
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      JOIN locations l ON l.id = s.location_id
      JOIN warehouses w ON w.id = l.warehouse_id
      WHERE w.warehouse_type = 'BTP' AND s.quantity <> 0 AND COALESCE(s.spec_key,'') IN ('', '||||')
      ORDER BY p.product_code`)).rows;
    printTable('5. Tồn BTP không có thông số (spec_key rỗng)', q5, 'Kiểm kê & gán thông số hoặc điều chỉnh.');

    console.log('\n✅ Rà soát xong (không thay đổi dữ liệu). Nhớ pg_dump sao lưu trước khi deploy.');
  } catch (e) {
    console.error('❌ Lỗi rà soát:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
