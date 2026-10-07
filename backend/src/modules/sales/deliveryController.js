// backend/controllers/deliveryController.js — Phiếu giao hàng & thanh toán
const db = require('../../core/db');
const { upUnit } = require('../../core/lib/units');
const { guardDelete } = require('../../core/lib/deleteGuard');
const { applyStock } = require('../../core/lib/stock');
const { buildSpecKey } = require('../../core/lib/specs');

const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);

// Bảng chuyển trạng thái hợp lệ cho phiếu giao (state machine).
// - "Giao hàng" KHÔNG nằm trong bảng: chỉ đặt qua nút Giao hàng (ship) — có xuất kho + trừ tồn.
// - "Bản nháp" chỉ được "Đã hủy" (chưa trừ kho) hoặc "Giao hàng" (qua nút). KHÔNG cho sang
//   các trạng thái sau giao để tránh đánh dấu đã bán/đã xuất HĐ mà chưa trừ kho.
// - Sau khi đã giao (đã trừ kho) KHÔNG cho "Đã hủy": chưa có luồng HOÀN KHO nên hủy sẽ mất tồn.
const DN_TRANSITIONS = {
  'Bản nháp':             ['Đã hủy'],
  'Giao hàng':            ['Đã xuất hóa đơn', 'Chờ thanh toán', 'Đã thanh toán 1 phần', 'Đã thanh toán'],
  'Đã xuất hóa đơn':      ['Chờ thanh toán', 'Đã thanh toán 1 phần', 'Đã thanh toán'],
  'Chờ thanh toán':       ['Đã xuất hóa đơn', 'Đã thanh toán 1 phần', 'Đã thanh toán'],
  'Đã thanh toán 1 phần': ['Chờ thanh toán', 'Đã thanh toán'],
  'Đã thanh toán':        [],
  'Đã hủy':               [],
};

// Quyền xem tiền ở Phiếu giao hàng (chặn ở backend — không chỉ ẩn UI) — helper dùng chung
const { canViewAmounts } = require('../../core/lib/money');
const stripMoneyItem = (it) => { const { unit_price, amount, ...rest } = it; return rest; };

exports.list = async (req, res) => {
  try {
    const where = ['d.is_deleted = FALSE']; const params = []; let i = 1;
    const { q, status } = req.query;
    if (status) { where.push(`d.status = $${i++}`); params.push(status); }
    if (q)      { where.push(`(d.note_code ILIKE $${i} OR c.name ILIKE $${i})`); params.push(`%${q}%`); i++; }
    const { rows } = await db.query(`
      SELECT d.*, c.name AS customer_name, so.order_code AS sales_order_code,
             (SELECT COUNT(*)::int FROM delivery_note_items it WHERE it.delivery_note_id = d.id) AS item_count
      FROM delivery_notes d
      LEFT JOIN customers c ON c.id = d.customer_id
      LEFT JOIN sales_orders so ON so.id = d.sales_order_id
      WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC`, params);
    if (!canViewAmounts(req)) rows.forEach((r) => { delete r.total_amount; delete r.paid_amount; });
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy danh sách phiếu' }); }
};

exports.getById = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT d.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
             so.order_code AS sales_order_code
      FROM delivery_notes d
      LEFT JOIN customers c ON c.id = d.customer_id
      LEFT JOIN sales_orders so ON so.id = d.sales_order_id
      WHERE d.id = $1 AND d.is_deleted = FALSE`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy phiếu' });
    const items = await db.query(`SELECT * FROM delivery_note_items WHERE delivery_note_id = $1 ORDER BY line_no`, [req.params.id]);
    const d = rows[0];
    if (!canViewAmounts(req)) {
      delete d.total_amount; delete d.paid_amount;
      return res.json({ ...d, items: items.rows.map(stripMoneyItem) });
    }
    res.json({ ...d, items: items.rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy chi tiết phiếu' }); }
};

// Lấy dòng hàng của 1 đơn để tạo phiếu giao: kèm SL đặt / đã SX / đã giao / còn lại
exports.fromOrder = async (req, res) => {
  try {
    const so = (await db.query(`
      SELECT so.id, so.order_code, so.customer_id, c.name AS customer_name
      FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.id = $1 AND so.is_deleted = FALSE`, [req.params.orderId])).rows[0];
    if (!so) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    const items = (await db.query(`
      SELECT it.id AS sales_order_item_id, it.product_id, p.product_name, it.specs, it.unit, it.unit_price,
             it.quantity AS ordered,
             COALESCE((SELECT SUM(po.posted_qty) FROM production_orders po
                       WHERE po.sales_order_item_id = it.id AND po.is_deleted = FALSE), 0) AS produced,
             COALESCE((SELECT SUM(COALESCE(di.actual_quantity, di.quantity)) FROM delivery_note_items di
                       JOIN delivery_notes dn ON dn.id = di.delivery_note_id
                       WHERE di.sales_order_item_id = it.id AND dn.is_deleted = FALSE AND dn.status NOT IN ('Bản nháp','Đã hủy')), 0) AS delivered
      FROM sales_order_items it JOIN products p ON p.id = it.product_id
      WHERE it.sales_order_id = $1 ORDER BY p.product_code`, [req.params.orderId])).rows;
    const showAmt = canViewAmounts(req);
    res.json({
      sales_order_id: so.id, sales_order_code: so.order_code, customer_id: so.customer_id, customer_name: so.customer_name,
      items: items.map((it) => {
        const ordered = Number(it.ordered) || 0, delivered = Number(it.delivered) || 0;
        const base = { ...it, ordered, produced: Number(it.produced) || 0, delivered, remaining: Math.max(0, ordered - delivered) };
        if (showAmt) base.unit_price = Number(it.unit_price) || 0; else delete base.unit_price;
        return base;
      }),
    });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi lấy đơn hàng' }); }
};

// Cập nhật trạng thái ĐƠN HÀNG sau khi giao: còn lại > 0 → "Chuyển hàng 1 phần"; = 0 (tất cả dòng) → "Hoàn thành"
async function updateOrderStatusAfterDelivery(client, salesOrderId) {
  if (!salesOrderId) return;
  const rows = (await client.query(`
    SELECT it.quantity AS ordered,
           COALESCE((SELECT SUM(COALESCE(di.actual_quantity, di.quantity)) FROM delivery_note_items di
                     JOIN delivery_notes dn ON dn.id = di.delivery_note_id
                     WHERE di.sales_order_item_id = it.id AND dn.is_deleted = FALSE AND dn.status NOT IN ('Bản nháp','Đã hủy')), 0) AS delivered
    FROM sales_order_items it WHERE it.sales_order_id = $1`, [salesOrderId])).rows;
  if (!rows.length) return;
  const anyDelivered = rows.some((r) => Number(r.delivered) > 0);
  if (!anyDelivered) return; // chưa giao gì thì không đổi trạng thái
  const allDone = rows.every((r) => Number(r.delivered) >= Number(r.ordered) - 1e-6);
  const newStatus = allDone ? 'Hoàn thành' : 'Chuyển hàng 1 phần';
  await client.query(
    `UPDATE sales_orders SET status = $1, updated_at = now() WHERE id = $2 AND is_deleted = FALSE AND status <> 'Đã hủy'`,
    [newStatus, salesOrderId]);
}

async function saveItems(client, noteId, items) {
  await client.query('DELETE FROM delivery_note_items WHERE delivery_note_id = $1', [noteId]);
  const list = (Array.isArray(items) ? items : []).filter((x) => x && (x.product_id || x.product_name));
  // Tra tên + đơn vị sản phẩm nếu dòng chưa có (đảm bảo NỘI DUNG luôn có dữ liệu)
  const ids = [...new Set(list.filter((x) => x.product_id).map((x) => x.product_id))];
  const pmap = {};
  if (ids.length) {
    const pr = await client.query(`SELECT id, product_name, unit FROM products WHERE id = ANY($1::uuid[])`, [ids]);
    pr.rows.forEach((p) => { pmap[p.id] = p; });
  }
  let n = 1, total = 0;
  for (const it of list) {
    const p = it.product_id ? pmap[it.product_id] : null;
    const qty = num(it.quantity), price = num(it.unit_price);
    const actQty = it.actual_quantity === '' || it.actual_quantity == null ? null : num(it.actual_quantity);
    const amount = (actQty !== null ? actQty : qty) * price; total += amount;
    await client.query(
      `INSERT INTO delivery_note_items (delivery_note_id, product_id, product_name, specs, quantity, unit, unit_price, amount, line_no, actual_quantity, sales_order_item_id)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)`,
      [noteId, it.product_id || null, it.product_name || (p && p.product_name) || null, JSON.stringify(it.specs || {}),
       qty, upUnit(it.unit || (p && p.unit)), price, amount, n++, actQty, it.sales_order_item_id || null]);
  }
  return total;
}

exports.create = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    if (!b.customer_id) return res.status(400).json({ message: 'Vui lòng chọn Khách hàng' });
    // Phiếu mới LUÔN là "Bản nháp" (bỏ qua b.status gửi lên) — mọi trạng thái sau đó phải đi
    // qua đúng luồng: "Giao hàng" bằng nút ship (trừ kho), rồi mới tới hóa đơn/thanh toán.
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO delivery_notes (sales_order_id, customer_id, delivery_date, status, note, paid_amount)
       VALUES ($1,$2,$3,'Bản nháp',$4,$5) RETURNING *`,
      [b.sales_order_id || null, b.customer_id, b.delivery_date || new Date(), b.note || null, num(b.paid_amount)]);
    const total = await saveItems(client, rows[0].id, b.items);
    await client.query(`UPDATE delivery_notes SET total_amount = $1 WHERE id = $2`, [total, rows[0].id]);
    await updateOrderStatusAfterDelivery(client, b.sales_order_id || null);
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], total_amount: total });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi tạo phiếu' }); }
  finally { client.release(); }
};

exports.update = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    await client.query('BEGIN');
    // Chặn đổi trạng thái tự do quanh "Giao hàng" (tránh: đánh dấu đã giao mà không trừ kho, hoặc trừ kho 2 lần)
    const cur = (await client.query(`SELECT status FROM delivery_notes WHERE id = $1 AND is_deleted = FALSE`, [req.params.id])).rows[0];
    if (!cur) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu' }); }
    if (b.status !== undefined && b.status !== cur.status) {
      if (b.status === 'Giao hàng') { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Không đặt trạng thái "Giao hàng" thủ công — hãy dùng nút "Giao hàng" để xuất kho + trừ tồn.' }); }
      const allowed = DN_TRANSITIONS[cur.status] || [];
      if (!allowed.includes(b.status)) { await client.query('ROLLBACK'); return res.status(400).json({ message: `Không thể chuyển trạng thái "${cur.status}" → "${b.status}".` }); }
    }
    // Chỉ cho sửa DÒNG HÀNG khi còn "Bản nháp": sau khi đã giao, dòng hàng đã quyết định lượng trừ kho → khóa lại.
    if (b.items !== undefined && cur.status !== 'Bản nháp') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Phiếu đã rời "Bản nháp" — không thể sửa dòng hàng (đã chốt theo lượng xuất kho).' });
    }
    const fields = ['sales_order_id', 'customer_id', 'delivery_date', 'status', 'note'];
    const cols = [], vals = []; let i = 1;
    for (const f of fields) if (b[f] !== undefined) { cols.push(`${f} = $${i++}`); vals.push(b[f] === '' ? null : b[f]); }
    if (b.paid_amount !== undefined) { cols.push(`paid_amount = $${i++}`); vals.push(num(b.paid_amount)); }
    cols.push(`updated_at = now()`);
    const r = await client.query(`UPDATE delivery_notes SET ${cols.join(', ')} WHERE id = $${i} AND is_deleted = FALSE RETURNING id`, [...vals, req.params.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu' }); }
    if (b.items !== undefined) {
      const total = await saveItems(client, req.params.id, b.items);
      await client.query(`UPDATE delivery_notes SET total_amount = $1 WHERE id = $2`, [total, req.params.id]);
    }
    // Lấy sales_order_id của phiếu để cập nhật trạng thái đơn
    const soId = (await client.query(`SELECT sales_order_id FROM delivery_notes WHERE id = $1`, [req.params.id])).rows[0]?.sales_order_id;
    await updateOrderStatusAfterDelivery(client, soId);
    await client.query('COMMIT');
    res.json({ message: 'Đã cập nhật phiếu' });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi cập nhật phiếu' }); }
  finally { client.release(); }
};

// POST /api/deliveries/:id/ship — XÁC NHẬN GIAO HÀNG
// Tự tạo 1 phiếu xuất kho (mục đích "Giao hàng cho khách") từ Kho Thành phẩm, trừ tồn (FIFO),
// chặn nếu tồn TP không đủ, rồi chuyển phiếu giao sang trạng thái "Giao hàng".
exports.ship = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const dn = (await client.query(
      `SELECT d.*, c.name AS customer_name, so.order_code AS sales_order_code
       FROM delivery_notes d
       LEFT JOIN customers c ON c.id = d.customer_id
       LEFT JOIN sales_orders so ON so.id = d.sales_order_id
       WHERE d.id = $1 AND d.is_deleted = FALSE`, [req.params.id])).rows[0];
    if (!dn) return res.status(404).json({ message: 'Không tìm thấy phiếu giao hàng' });
    if (dn.status === 'Đã hủy') return res.status(400).json({ message: 'Phiếu đã hủy, không thể giao hàng.' });
    if (dn.status !== 'Bản nháp') return res.status(400).json({ message: `Phiếu đã ở trạng thái "${dn.status}" — chỉ giao hàng được từ "Bản nháp".` });

    const items = (await client.query(
      `SELECT product_id, product_name, specs, unit,
              COALESCE(actual_quantity, quantity) AS qty
       FROM delivery_note_items WHERE delivery_note_id = $1`, [req.params.id])).rows;
    // Gộp theo (sản phẩm + thông số) để trừ ĐÚNG biến thể; số lượng = COALESCE(SL thực, SL giao)
    const byKey = new Map();
    for (const it of items) {
      if (!it.product_id) return res.status(400).json({ message: `Dòng "${it.product_name || ''}" chưa gắn sản phẩm trong kho — không thể xuất kho.` });
      const q = Number(it.qty) || 0;
      if (q <= 0) continue;
      const sk = buildSpecKey(it.specs || {});
      const key = `${it.product_id}|${sk}`;
      const cur = byKey.get(key) || { product_id: it.product_id, product_name: it.product_name, unit: it.unit, spec_key: sk, qty: 0 };
      cur.qty += q; byKey.set(key, cur);
    }
    const lines = [...byKey.values()];
    if (!lines.length) return res.status(400).json({ message: 'Phiếu chưa có dòng hàng có số lượng giao > 0.' });

    // Phân bổ FIFO + kiểm tra đủ tồn trước khi trừ (chỉ lấy ở NVL/BTP/TP, ưu tiên kho Thành phẩm).
    // M10: dòng CÓ thông số (giao theo đơn) → chỉ lấy đúng spec_key, thiếu thì báo thiếu
    //      (trước đây chỉ ưu tiên rồi lấy bù biến thể khác → giao nhầm màu/kích thước).
    //      Dòng KHÔNG thông số (bán hàng tồn kho không theo đơn) → lấy mọi biến thể như cũ.
    // M11: theo dõi lượng còn lại của từng dòng tồn (`left`) để các dòng phiếu không dùng trùng
    //      một dòng tồn; xử lý dòng có thông số trước để dòng "bất kỳ" không lấy mất hàng của chúng.
    const EMPTY_SPEC = buildSpecKey({});
    lines.sort((a, b) => Number(a.spec_key === EMPTY_SPEC) - Number(b.spec_key === EMPTY_SPEC));
    const left = new Map(); // `${location_id}|${lot_code}|${spec_key}` → lượng còn lại sau các dòng trước
    const rowKey = (r) => `${r.location_id}|${r.lot_code || ''}|${r.spec_key}`;
    const shortages = [], allocations = [];
    for (const l of lines) {
      const need = Number(l.qty);
      const strict = l.spec_key !== EMPTY_SPEC;
      const { rows: stockRows } = await client.query(
        `SELECT s.location_id, s.lot_code, s.quantity, s.unit, s.spec_key, s.specs
         FROM inventory_stock s
         JOIN locations lo ON lo.id = s.location_id
         JOIN warehouses w ON w.id = lo.warehouse_id
         WHERE s.product_id = $1 AND s.quantity > 0 AND w.warehouse_type IN ('NVL','BTP','TP')
           AND (NOT $3::boolean OR s.spec_key = $2)
         ORDER BY (s.spec_key = $2) DESC, (w.warehouse_type = 'TP') DESC, s.id ASC`,
        [l.product_id, l.spec_key, strict]);
      const avail = (r) => (left.has(rowKey(r)) ? left.get(rowKey(r)) : Number(r.quantity));
      const onHand = stockRows.reduce((s, r) => s + avail(r), 0);
      if (need > onHand + 1e-6) {
        shortages.push({ name: l.product_name + (strict ? ` (đúng thông số ${l.spec_key.split('|').filter(Boolean).join(', ')})` : ''), unit: l.unit || '', on_hand: onHand, need, lack: need - onHand });
      } else {
        let remain = need;
        for (const sr of stockRows) {
          if (remain <= 1e-9) break;
          const a = avail(sr);
          if (a <= 1e-9) continue;
          const take = Math.min(remain, a);
          left.set(rowKey(sr), a - take);
          allocations.push({ product_id: l.product_id, location_id: sr.location_id, lot_code: sr.lot_code || '', spec_key: sr.spec_key, specs: sr.specs || {}, quantity: take, unit: l.unit || sr.unit });
          remain -= take;
        }
      }
    }
    if (shortages.length) {
      const msg = 'Không đủ tồn kho để giao — vui lòng sản xuất/nhập kho trước:\n' +
        shortages.map((x) => `• ${x.name}: tồn ${x.on_hand} ${x.unit}, cần giao ${x.need} ${x.unit} → thiếu ${x.lack} ${x.unit}`).join('\n');
      return res.status(400).json({ message: msg, shortages });
    }
    const slipLoc = allocations[0].location_id; // kho đại diện cho phiếu xuất (có thể gồm nhiều kho)

    await client.query('BEGIN');
    // Chống bấm đúp / gọi đồng thời: chỉ MỘT request "chiếm" được phiếu từ Bản nháp (atomic).
    // Request thua sẽ không trừ kho lần 2.
    const claim = await client.query(
      `UPDATE delivery_notes SET status = 'Giao hàng', updated_at = now()
       WHERE id = $1 AND status = 'Bản nháp' AND is_deleted = FALSE RETURNING id`, [req.params.id]);
    if (!claim.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Phiếu đã được giao hoặc đang được xử lý — vui lòng tải lại.' }); }
    // Sinh mã phiếu xuất kho PXK00001…
    const slipCode = (await client.query(
      `SELECT 'PXK' || LPAD((COALESCE(MAX(NULLIF(regexp_replace(slip_code,'\\D','','g'),''))::int,0)+1)::text,5,'0') AS code
       FROM outbound_slips WHERE slip_code ~ '^PXK[0-9]+$'`)).rows[0].code;
    const slip = (await client.query(
      `INSERT INTO outbound_slips (slip_code, purpose, location_id, status, note, confirmed_at, created_by)
       VALUES ($1,'Giao hàng cho khách',$2,'Đã xuất',$3, now(), $4) RETURNING id, slip_code`,
      [slipCode, slipLoc, `Giao hàng phiếu ${dn.note_code}${dn.customer_name ? ' · ' + dn.customer_name : ''}`, req.userId || null])).rows[0];

    for (const l of lines) await client.query(
      `INSERT INTO outbound_slip_lines (slip_id, product_id, quantity, unit, lot_code, note) VALUES ($1,$2,$3,$4,'',$5)`,
      [slip.id, l.product_id, Number(l.qty), upUnit(l.unit), null]);

    for (const a of allocations) await applyStock(client, {
      product_id: a.product_id, location_id: a.location_id, delta: -a.quantity, unit: a.unit,
      specs: a.specs, spec_key: a.spec_key, lot_code: a.lot_code,
      clampZero: false, trx_type: 'Xuất', ref_code: slip.slip_code, note: `Giao hàng cho khách (${dn.note_code})`,
    });

    // (trạng thái 'Giao hàng' đã được set atomically ở bước "claim" đầu transaction)
    await updateOrderStatusAfterDelivery(client, dn.sales_order_id || null);
    await client.query('COMMIT');
    res.json({ message: `Đã giao hàng — tạo phiếu xuất kho ${slip.slip_code} (${lines.length} dòng) và trừ tồn kho.`, slip_code: slip.slip_code, slip_id: slip.id });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ message: err.detail || 'Lỗi khi giao hàng' }); }
  finally { client.release(); }
};

exports.remove = async (req, res) => {
  try {
    const g = await guardDelete('delivery_notes', req.params.id, {
      allow: ['Đã hủy'],
      message: 'Không thể xóa phiếu đang xử lý / đã thu tiền. Chỉ xóa được phiếu ở trạng thái "Đã hủy" — vui lòng chuyển phiếu sang "Đã hủy" trước, rồi mới xóa.',
    });
    if (g.notFound) return res.status(404).json({ message: 'Không tìm thấy phiếu' });
    if (g.blocked) return res.status(400).json({ message: g.message });

    const { rowCount } = await db.query(`UPDATE delivery_notes SET is_deleted = TRUE WHERE id = $1 AND is_deleted = FALSE`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy phiếu' });
    res.json({ message: 'Đã xóa phiếu' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Lỗi khi xóa phiếu' }); }
};
