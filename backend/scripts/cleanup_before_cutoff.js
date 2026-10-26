// Dọn dữ liệu TEST trước ngày chốt (mặc định 2026-10-01) — giữ nguyên danh mục & tồn kho hiện tại.
//
//   node scripts/cleanup_before_cutoff.js                 → CHẠY THỬ: in số dòng sẽ xóa rồi ROLLBACK (không đổi gì)
//   node scripts/cleanup_before_cutoff.js --apply         → xóa thật (COMMIT)
//   node scripts/cleanup_before_cutoff.js --cutoff=2026-10-01 --apply
//
// BẮT BUỘC sao lưu DB trước khi --apply.
//
// Xóa (chứng từ có ngày < cutoff):
//   đơn hàng (order_date), LSX (created_at), phiếu giao (delivery_date), phiếu xuất kho (slip_date),
//   phiếu thanh toán (pay_date), phiếu phế (record_date), phiếu tái chế (export_date),
//   lịch làm việc (work_date), lịch sử kho inventory_transactions (created_at).
// Giữ lại dù cũ: đơn hàng còn được phiếu giao / LSX sau cutoff dùng tới (in ra danh sách).
// KHÔNG đụng: sản phẩm, khách hàng, BOM, kho/vị trí, máy, người dùng, nhân sự/chấm công, cài đặt,
//   bảng tồn inventory_stock (số tồn hiện tại giữ nguyên).
// Lịch sử kho: phần đã xóa được gộp thành 1 dòng 'Điều chỉnh' TON-DAU-KY / tồn để sổ kho vẫn khớp số tồn.
// Công nợ: phân bổ lại (rebuildCustomer) cho mọi khách bị ảnh hưởng.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../src/core/db');
const { rebuildCustomer } = require('../src/core/lib/receivables');

const APPLY = process.argv.includes('--apply');
const CUTOFF = (process.argv.find((a) => a.startsWith('--cutoff=')) || '--cutoff=2026-10-01').split('=')[1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(CUTOFF)) { console.error('Sai định dạng --cutoff (YYYY-MM-DD)'); process.exit(1); }

async function main() {
  const client = await db.pool.connect();
  const exists = async (t) => (await client.query(`SELECT to_regclass($1) IS NOT NULL ok`, [t])).rows[0].ok;
  const count = async (sql) => Number((await client.query(sql, [CUTOFF])).rows[0].n);
  const del = async (label, sql) => {
    const n = (await client.query(sql, [CUTOFF])).rowCount;
    console.log(`  - ${label.padEnd(42)} ${n}`);
  };
  try {
    console.log(`Cutoff: ${CUTOFF} — chế độ: ${APPLY ? 'XÓA THẬT' : 'CHẠY THỬ (sẽ ROLLBACK)'}`);
    console.log(`DB: ${process.env.DATABASE_URL ? 'DATABASE_URL (từ xa)' : `${process.env.PGHOST || 'localhost'}/${process.env.PGDATABASE || 'mes'}`}\n`);
    await client.query('BEGIN');
    // Không cho chạy hai lần cleanup đồng thời trên cùng database.
    const lock = (await client.query("SELECT pg_try_advisory_xact_lock(20261001, 1) AS ok")).rows[0];
    if (!lock.ok) throw new Error('Một phiên cleanup khác đang chạy — dừng để tránh xung đột.');

    // Snapshot số lượng tồn: việc dọn chứng từ không được làm thay đổi tồn thực tế.
    await client.query('CREATE TEMP TABLE cleanup_stock_before ON COMMIT DROP AS SELECT id, quantity FROM inventory_stock');

    // Cấm chạy lại với tồn đầu kỳ đã gộp: truy vấn gộp bao gồm cả dòng cũ,
    // còn DELETE lại giữ nó, dẫn đến cộng trùng lịch sử.
    const existingOpening = (await client.query(
      "SELECT COUNT(*)::int AS n FROM inventory_transactions WHERE ref_code = 'TON-DAU-KY' AND created_at < $1::date",
      [CUTOFF]
    )).rows[0].n;
    if (existingOpening > 0) {
      throw new Error('Đã tồn tại ' + existingOpening + ' dòng TON-DAU-KY trước cutoff. Không chạy lại để tránh cộng trùng. Cần kiểm tra lịch sử kho trước.');
    }

    // ---------- 1. Xác định tập cần xóa ----------
    await client.query(`CREATE TEMP TABLE x_dn ON COMMIT DROP AS
      SELECT id, customer_id FROM delivery_notes WHERE delivery_date < $1`, [CUTOFF]);
    await client.query(`CREATE TEMP TABLE x_po ON COMMIT DROP AS
      SELECT id FROM production_orders WHERE created_at < $1::date`, [CUTOFF]);
    await client.query(`CREATE TEMP TABLE x_so ON COMMIT DROP AS
      SELECT id FROM sales_orders WHERE order_date < $1`, [CUTOFF]);
    // Đơn cũ nhưng còn phiếu giao / LSX được giữ dùng tới → giữ đơn
    const keptSo = (await client.query(`
      SELECT s.id, s.order_code FROM sales_orders s JOIN x_so USING (id)
      WHERE EXISTS (SELECT 1 FROM delivery_notes d WHERE d.sales_order_id = s.id AND d.id NOT IN (SELECT id FROM x_dn))
         OR EXISTS (SELECT 1 FROM delivery_note_items di JOIN sales_order_items si ON si.id = di.sales_order_item_id
                    JOIN delivery_notes d ON d.id = di.delivery_note_id
                    WHERE si.sales_order_id = s.id AND d.id NOT IN (SELECT id FROM x_dn))
         OR EXISTS (SELECT 1 FROM production_orders p WHERE p.sales_order_id = s.id AND p.id NOT IN (SELECT id FROM x_po))`)).rows;
    await client.query(`DELETE FROM x_so WHERE id = ANY($1)`, [keptSo.map((r) => r.id)]);
    await client.query(`CREATE TEMP TABLE x_rc ON COMMIT DROP AS
      SELECT id, customer_id FROM payment_receipts WHERE pay_date < $1`, [CUTOFF]);
    await client.query(`CREATE TEMP TABLE x_cust ON COMMIT DROP AS
      SELECT customer_id FROM x_dn UNION SELECT customer_id FROM x_rc`);

    // ---------- 2. Công nợ ----------
    console.log('Công nợ:');
    await del('Phân bổ đầu kỳ (tính lại sau)', `DELETE FROM opening_balance_payments WHERE customer_id IN (SELECT customer_id FROM x_cust) AND $1::text IS NOT NULL`);
    await del('Lần thu / phân bổ của phiếu giao cũ', `DELETE FROM delivery_payments WHERE (delivery_note_id IN (SELECT id FROM x_dn) OR receipt_id IN (SELECT id FROM x_rc)) AND $1::text IS NOT NULL`);
    await del('Phiếu thanh toán', `DELETE FROM payment_receipts WHERE id IN (SELECT id FROM x_rc) AND $1::text IS NOT NULL`);

    // ---------- 3. Giao hàng / xuất kho ----------
    console.log('Giao hàng / xuất kho:');
    await del('Phiếu xuất kho', `DELETE FROM outbound_slips WHERE slip_date < $1 OR delivery_note_id IN (SELECT id FROM x_dn)`);
    await del('Phiếu trả hàng', `DELETE FROM delivery_returns WHERE delivery_note_id IN (SELECT id FROM x_dn) AND $1::text IS NOT NULL`);
    await del('Phiếu giao', `DELETE FROM delivery_notes WHERE id IN (SELECT id FROM x_dn) AND $1::text IS NOT NULL`);

    // ---------- 4. Sản xuất ----------
    console.log('Sản xuất:');
    await client.query(`UPDATE inventory_stock SET prod_order_id = NULL WHERE prod_order_id IN (SELECT id FROM x_po)`);
    await del('Cuộn đã dùng của LSX', `DELETE FROM production_roll_usage WHERE production_order_id IN (SELECT id FROM x_po) AND $1::text IS NOT NULL`);
    await del('LSX (kèm công đoạn, NVL)', `DELETE FROM production_orders WHERE id IN (SELECT id FROM x_po) AND $1::text IS NOT NULL`);
    await del('Phiếu phế hằng ngày', `DELETE FROM daily_scrap_records WHERE record_date < $1`);
    await del('Phiếu tái chế', `DELETE FROM recycling_tickets WHERE export_date < $1`);
    if (await exists('work_schedules')) await del('Lịch làm việc', `DELETE FROM work_schedules WHERE work_date < $1`);

    // ---------- 5. Đơn hàng ----------
    console.log('Kinh doanh:');
    await del('Đơn hàng (kèm dòng hàng)', `DELETE FROM sales_orders WHERE id IN (SELECT id FROM x_so) AND $1::text IS NOT NULL`);

    // ---------- 6. Lịch sử kho → gộp thành tồn đầu kỳ ----------
    // Không qua applyStock: số tồn KHÔNG đổi, chỉ thay nhiều dòng lịch sử bằng 1 dòng tổng tương đương.
    console.log('Kho:');
    const ins = await client.query(`
      INSERT INTO inventory_transactions (product_id, location_id, trx_type, quantity, delta, specs, spec_key, lot_code,
                                          ref_code, note, created_at, created_by_name)
      SELECT product_id, location_id, 'Điều chỉnh', ABS(SUM(d)), SUM(d), (array_agg(specs ORDER BY id DESC))[1], spec_key, lot_code,
             'TON-DAU-KY', 'Tồn đầu kỳ (gộp lịch sử trước ' || $1 || ')', $1::date - interval '1 second', 'cleanup'
      FROM (SELECT *, COALESCE(delta, CASE trx_type WHEN 'Nhập' THEN quantity WHEN 'Xuất' THEN -quantity ELSE 0 END) d
            FROM inventory_transactions WHERE created_at < $1::date) t
      GROUP BY product_id, location_id, spec_key, lot_code
      HAVING SUM(d) <> 0`, [CUTOFF]);
    await del('Dòng lịch sử kho cũ', `DELETE FROM inventory_transactions WHERE created_at < $1::date AND ref_code IS DISTINCT FROM 'TON-DAU-KY'`);
    console.log(`  + ${'Dòng tồn đầu kỳ thêm vào'.padEnd(42)} ${ins.rowCount}`);

    // ---------- 7. Phân bổ lại công nợ ----------
    const custs = (await client.query(`SELECT customer_id FROM x_cust WHERE customer_id IS NOT NULL`)).rows;
    for (const { customer_id } of custs) await rebuildCustomer(client, customer_id);
    console.log(`\nPhân bổ lại công nợ cho ${custs.length} khách.`);

    const stockDiff = (await client.query(`
      SELECT COUNT(*)::int AS n
      FROM (
        (SELECT id, quantity FROM inventory_stock
         EXCEPT ALL SELECT id, quantity FROM cleanup_stock_before)
        UNION ALL
        (SELECT id, quantity FROM cleanup_stock_before
         EXCEPT ALL SELECT id, quantity FROM inventory_stock)
      ) diff
    `)).rows[0].n;
    if (stockDiff > 0) throw new Error('Đối chiếu tồn kho thất bại: có ' + stockDiff + ' dòng chênh lệch. Đã chặn COMMIT.');
    console.log('Đối chiếu tồn kho: số lượng không đổi.');

    if (keptSo.length) console.log(`\nGIỮ LẠI ${keptSo.length} đơn cũ vì còn phiếu giao/LSX sau cutoff: ${keptSo.map((r) => r.order_code).join(', ')}`);
    const neg = await count(`SELECT COUNT(*) n FROM inventory_stock WHERE quantity < 0 AND $1::text IS NOT NULL`);
    if (neg) console.log(`Lưu ý: còn ${neg} dòng tồn âm — cần kiểm kê / Điều chỉnh.`);

    if (APPLY) { await client.query('COMMIT'); console.log('\n✔ ĐÃ XÓA (COMMIT).'); }
    else { await client.query('ROLLBACK'); console.log('\n(Chạy thử — đã ROLLBACK, dữ liệu không đổi. Thêm --apply để xóa thật.)'); }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✘ LỖI — đã ROLLBACK, không có gì bị xóa:', err.message, err.detail || '');
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
