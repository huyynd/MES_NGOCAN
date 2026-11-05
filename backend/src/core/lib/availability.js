// backend/src/core/lib/availability.js
// Số lượng KHẢ DỤNG tính theo TỪNG DÒNG TỒN (sản phẩm + vị trí + thông số + lô) = Tồn − Đang giữ.
//   pending: đã lên phiếu Chờ xuất. Dòng phiếu chỉ rõ thông số / lô → giữ đúng dòng đó;
//            không chỉ rõ → giữ theo FIFO tại vị trí xuất của phiếu (đúng thứ tự lúc xác nhận sẽ trừ).
//   blocked: dòng ở kho / vị trí đã xóa, ngừng hoạt động, cấm xuất → khả dụng 0.
const { StockShortageError, whOutboundOkSql } = require('./stock');
const { specKeyValues } = require('./specs');

const fmt = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const EPS = 1e-6;

// Trả về mảng dòng tồn { id, product_id, location_id, location_name, spec_key, lot_code, quantity, pending, blocked, available }.
// excludeSlipId: bỏ qua phiếu đang xét, để phiếu không tự giữ hàng của chính nó.
async function stockAvailabilityRows(conn, productIds, excludeSlipId = null) {
  const ids = [...new Set(productIds.filter(Boolean).map(String))];
  if (!ids.length) return [];
  const rows = (await conn.query(
    `SELECT s.id, s.product_id::text AS product_id, s.location_id, l.name AS location_name, s.spec_key, s.lot_code,
            s.quantity::float8 AS quantity, COALESCE(${whOutboundOkSql('w', 'l')}, FALSE) AS ok
       FROM inventory_stock s
       LEFT JOIN locations l ON l.id = s.location_id
       LEFT JOIN warehouses w ON w.id = l.warehouse_id
      WHERE s.product_id = ANY($1::uuid[]) AND s.quantity > 0
      ORDER BY s.created_at, s.lot_code, s.id`, [ids])).rows
    .map((r) => ({ ...r, pending: 0, blocked: r.ok ? 0 : r.quantity, available: r.ok ? r.quantity : 0 }));
  const lines = (await conn.query(
    `SELECT sl.product_id::text AS product_id, COALESCE(sl.location_id, os.location_id) AS location_id,
            sl.spec_key, COALESCE(sl.lot_code, '') AS lot_code, sl.quantity::float8 AS quantity
       FROM outbound_slip_lines sl JOIN outbound_slips os ON os.id = sl.slip_id
      WHERE os.status = 'Chờ xuất' AND sl.product_id = ANY($1::uuid[]) AND os.id IS DISTINCT FROM $2::uuid`, [ids, excludeSlipId])).rows;
  // Dòng phiếu càng cụ thể giữ trước, dòng không chỉ định lấy trên phần còn lại
  const rank = (l) => (l.lot_code ? 0 : 2) + (l.spec_key ? 0 : 1);
  for (const l of lines.sort((a, b) => rank(a) - rank(b))) {
    let remain = l.quantity;
    for (const r of rows) {
      if (remain <= EPS) break;
      if (r.product_id !== l.product_id || r.location_id !== l.location_id) continue;
      if ((l.lot_code && r.lot_code !== l.lot_code) || (l.spec_key && r.spec_key !== l.spec_key)) continue;
      const take = Math.min(remain, r.available);
      r.pending += take; r.available -= take; remain -= take;
    }
  }
  return rows;
}

// Tổng theo sản phẩm (màn LSX, kế hoạch, đơn hàng)
async function stockAvailability(conn, productIds, excludeSlipId = null) {
  const out = new Map([...new Set(productIds.filter(Boolean).map(String))]
    .map((id) => [id, { on_hand: 0, pending: 0, blocked: 0, held: 0, available: 0 }]));
  for (const r of await stockAvailabilityRows(conn, productIds, excludeSlipId)) {
    const a = out.get(r.product_id);
    a.on_hand += r.quantity; a.pending += r.pending; a.blocked += r.blocked; a.available += r.available;
    a.held = a.pending + a.blocked;
  }
  return out;
}

// Khóa theo sản phẩm: 2 thao tác cùng lúc xếp hàng, thao tác sau thấy phiếu của thao tác trước. Gọi trong transaction.
async function lockProducts(client, productIds) {
  for (const id of [...new Set(productIds.filter(Boolean).map(String))].sort()) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`avail:${id}`]);
  }
}

// needs: [{ product_id, qty, location_id?, spec_key?, lot_code? }] — trường nào có thì chỉ tính đúng phần đó.
// Thiếu → StockShortageError (400), ghi rõ vị trí / thông số / lô.
async function assertAvailable(client, needs, excludeSlipId = null) {
  const list = needs.filter((n) => Number(n.qty) > 0);
  if (!list.length) return;
  const ids = list.map((n) => n.product_id);
  await lockProducts(client, ids);
  const rows = await stockAvailabilityRows(client, ids, excludeSlipId);
  const rank = (n) => (n.lot_code ? 0 : 2) + (n.spec_key ? 0 : 1);
  const shorts = [];
  for (const n of [...list].sort((a, b) => rank(a) - rank(b))) {
    const pool = rows.filter((r) => r.product_id === String(n.product_id)
      && (!n.location_id || String(r.location_id) === String(n.location_id))
      && (!n.spec_key || r.spec_key === n.spec_key)
      && (!n.lot_code || r.lot_code === n.lot_code));
    const avail = pool.reduce((s, r) => s + r.available, 0);
    let remain = Number(n.qty);
    if (remain > avail + EPS) { shorts.push({ n, pool, avail }); continue; }
    for (const r of pool) { const take = Math.min(remain, r.available); r.available -= take; remain -= take; }
  }
  if (!shorts.length) return;
  const names = new Map((await client.query(
    `SELECT id::text AS id, product_code, product_name FROM products WHERE id = ANY($1::uuid[])`,
    [shorts.map((s) => String(s.n.product_id))])).rows.map((p) => [p.id, p]));
  const msg = shorts.map(({ n, pool, avail }) => {
    const p = names.get(String(n.product_id)) || {};
    const sum = (k) => pool.reduce((s, r) => s + r[k], 0);
    const where = [n.spec_key && specKeyValues(n.spec_key).join(' · '), n.lot_code && `lô ${n.lot_code}`,
      n.location_id && pool[0]?.location_name && `vị trí ${pool[0].location_name}`].filter(Boolean).join(', ');
    return `• ${p.product_code || ''} ${p.product_name || ''}${where ? ` (${where})` : ''}: tồn ${fmt(sum('quantity'))}, đang giữ ${fmt(sum('pending') + sum('blocked'))} (phiếu chờ ${fmt(sum('pending'))}, kho không xuất được ${fmt(sum('blocked'))}), khả dụng ${fmt(avail)}, cần ${fmt(n.qty)}`;
  }).join('\n');
  throw new StockShortageError(`Không đủ số lượng khả dụng:\n${msg}`, { products: shorts.map((s) => s.n.product_id) });
}

module.exports = { stockAvailabilityRows, stockAvailability, lockProducts, assertAvailable };
