// backend/src/core/lib/materialReturns.js
// Phiếu trả hàng về kho từ phiếu xuất ĐÃ XUẤT: trả NVL thừa, hủy LSX, đảo phiếu xác nhận nhầm.
// Nguồn = từng giao dịch "Xuất" của phiếu (SP · lô · thông số · vị trí). Trả nhiều lần không vượt phần đã xuất.
// Mọi hàm PHẢI gọi trong transaction (đã BEGIN).
const { applyStock, whInboundOkSql } = require('./stock');
const { nextCode } = require('./codes');
const { assertAvailable } = require('./availability');
const { currentUser } = require('../requestContext');

// cond dùng alias s = outbound_slips
const sourcesSql = (cond) => `
  SELECT t.id AS trx_id, s.id AS slip_id, s.slip_code, t.product_id, p.product_code, p.product_name, p.unit,
         t.location_id, l.name AS location_name, w.name AS warehouse_name, w.warehouse_type,
         t.spec_key, t.specs, t.lot_code, t.quantity AS issued_qty,
         COALESCE((SELECT SUM(ri.quantity) FROM material_return_items ri WHERE ri.source_trx_id = t.id), 0) AS returned_qty,
         COALESCE(${whInboundOkSql('w', 'l')}, FALSE) AS loc_ok
    FROM outbound_slips s
    JOIN inventory_transactions t ON t.ref_code = s.slip_code AND t.trx_type = 'Xuất'
    JOIN products p ON p.id = t.product_id
    LEFT JOIN locations l ON l.id = t.location_id
    LEFT JOIN warehouses w ON w.id = l.warehouse_id
   WHERE s.status = 'Đã xuất' AND ${cond}
   ORDER BY p.product_code, s.slip_code, t.lot_code, t.created_at`;

const orderSources = async (conn, poId) => (await conn.query(sourcesSql('s.prod_order_id = $1'), [poId])).rows;
const slipSources = async (conn, slipId) => (await conn.query(sourcesSql('s.id = $1'), [slipId])).rows;
const remaining = (r) => Number(r.issued_qty) - Number(r.returned_qty);

// SL NVL thực đang ở xưởng theo từng sản phẩm = đã xuất − đã trả
function netByProduct(sources) {
  const m = new Map();
  for (const r of sources) m.set(r.product_id, (m.get(r.product_id) || 0) + remaining(r));
  return m;
}

// picks: [{ source, quantity }]. Trả về vị trí cũ; vị trí đó không còn nhận hàng → vị trí đầu tiên cùng loại kho đang cho nhập.
async function postReturn(client, { prefix = 'TNVL', orderId = null, reason, note = null, picks }) {
  const code = await nextCode(client, { table: 'inventory_transactions', col: 'ref_code', prefix, width: 5 });
  const who = currentUser();
  const ret = (await client.query(
    `INSERT INTO material_returns (return_code, production_order_id, reason, note, created_by, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [code, orderId, reason, note, who?.id || null, who?.name || null])).rows[0];
  for (const { source: r, quantity } of picks) {
    let loc = r.location_id;
    if (!r.loc_ok) {
      loc = (await client.query(
        `SELECT l.id FROM locations l JOIN warehouses w ON w.id = l.warehouse_id
          WHERE w.warehouse_type = $1 AND ${whInboundOkSql('w', 'l')} ORDER BY l.created_at LIMIT 1`, [r.warehouse_type])).rows[0]?.id || r.location_id;
    }
    await applyStock(client, {
      product_id: r.product_id, location_id: loc, delta: quantity, unit: r.unit,
      specs: r.specs || {}, spec_key: r.spec_key, lot_code: r.lot_code || '',
      trx_type: 'Nhập', ref_code: code, note: `${reason} (phiếu ${r.slip_code})${note ? ' | ' + note : ''}`,
    });
    await client.query(
      `INSERT INTO material_return_items (return_id, source_trx_id, product_id, quantity, location_id) VALUES ($1,$2,$3,$4,$5)`,
      [ret.id, r.trx_id, r.product_id, quantity, loc]);
  }
  return code;
}

// Lệnh còn phiếu Chờ xuất / Đã xuất không (cờ materials_issued)
const refreshIssuedFlag = (client, poId) => client.query(
  `UPDATE production_orders SET materials_issued = EXISTS (
     SELECT 1 FROM outbound_slips WHERE prod_order_id = $1 AND status IN ('Chờ xuất', 'Đã xuất')) WHERE id = $1`, [poId]);

// Phần NVL còn thiếu = danh sách cần − (đã xuất − đã trả)
async function materialNeeds(client, poId) {
  const net = netByProduct(await orderSources(client, poId));
  const plan = (await client.query(
    `SELECT material_id, SUM(qty) AS qty, MAX(unit) AS unit, MAX(note) AS note FROM production_order_materials
      WHERE production_order_id = $1 GROUP BY material_id`, [poId])).rows;
  return plan.map((p) => ({ ...p, need: Number(p.qty) - (net.get(p.material_id) || 0) })).filter((p) => p.need > 1e-6);
}

// Phiếu CHƯA xuất luôn = phần còn thiếu: danh sách NVL đổi → sửa đè đúng phiếu đó (giữ mã); hết thiếu → hủy phiếu.
async function syncPendingSlip(client, poId) {
  const slip = (await client.query(
    `SELECT id, location_id FROM outbound_slips WHERE prod_order_id = $1 AND status = 'Chờ xuất' ORDER BY created_at DESC LIMIT 1`, [poId])).rows[0];
  if (!slip) return;
  const needs = await materialNeeds(client, poId);
  await assertAvailable(client, needs.map((n) => ({ product_id: n.material_id, qty: n.need, location_id: slip.location_id })), slip.id); // tăng phiếu chờ phải còn khả dụng
  await client.query(`DELETE FROM outbound_slip_lines WHERE slip_id = $1`, [slip.id]);
  for (const n of needs) await client.query(
    `INSERT INTO outbound_slip_lines (slip_id, product_id, quantity, unit, lot_code, note) VALUES ($1,$2,$3,$4,'',$5)`,
    [slip.id, n.material_id, n.need, n.unit, n.note]);
  if (!needs.length) await client.query(`UPDATE outbound_slips SET status = 'Đã hủy' WHERE id = $1`, [slip.id]);
  await refreshIssuedFlag(client, poId);
}

module.exports = { orderSources, slipSources, remaining, netByProduct, postReturn, refreshIssuedFlag, materialNeeds, syncPendingSlip };
