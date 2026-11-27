// backend/src/core/lib/slipIssue.js
// Lõi FIFO trừ tồn cho 1 phiếu xuất kho — tách NGUYÊN VẸN từ confirmOutboundSlip (inventoryController.js, 2026-11-25)
// để "Yêu cầu NVL" (lệnh nvl_strict) xuất ngay trong cùng transaction. KHÔNG tự BEGIN/COMMIT/ROLLBACK:
// người gọi mở transaction, gặp SlipIssueError thì ROLLBACK và trả err.status + { message, shortages }.
// Không đổi trạng thái phiếu (người gọi "chiếm" phiếu / chèn phiếu Đã xuất).
const { applyStock } = require('./stock');
const { stockAvailabilityRows, lockProducts } = require('./availability');
const { specKeyValues } = require('./specs');

const specLabel = (k) => (specKeyValues(k).join(' · ') || 'không thông số');

class SlipIssueError extends Error {
  constructor(message, { status = 400, shortages } = {}) {
    super(message);
    this.name = 'SlipIssueError';
    this.status = status;
    if (shortages) this.shortages = shortages;
  }
}

/**
 * Trừ tồn FIFO theo các dòng phiếu xuất `slipId` tại vị trí xuất của phiếu.
 * @returns {{ slip, lines, allocations: Array<{product_id, lot_code, spec_key, specs, quantity, unit}> }}
 * @throws SlipIssueError (400) khi phiếu không có dòng, nhiều thông số không chọn, hoặc thiếu tồn khả dụng.
 */
async function issueSlipFIFO(client, slipId) {
  const s = (await client.query(`SELECT * FROM outbound_slips WHERE id = $1`, [slipId])).rows[0];
  if (!s) throw new SlipIssueError('Không tìm thấy phiếu xuất', { status: 404 });
  const lines = (await client.query(`SELECT * FROM outbound_slip_lines WHERE slip_id = $1`, [slipId])).rows;
  if (!lines.length) throw new SlipIssueError('Phiếu chưa có dòng hàng.');

  // Gộp SL theo (sản phẩm, lô) TRƯỚC khi kiểm tồn — nhiều dòng cùng 1 SP không được kiểm độc lập
  // (vd 80 + 80 khi tồn 100 PHẢI báo thiếu). M50: dòng có ghi lô chỉ được trừ đúng lô đó.
  // K-05: dòng có chọn thông số (spec_key) chỉ trừ đúng thông số đó.
  const needs = new Map(); // key product|lot|spec → { product_id, lot_code, spec_key, unit, qty }
  for (const l of lines) {
    const q = Number(l.quantity) || 0; if (q <= 0) continue;
    const lot = l.lot_code || '';
    const spec = l.spec_key || null;
    const key = `${l.product_id}|${lot}|${spec ?? ''}`;
    const cur = needs.get(key) || { product_id: l.product_id, lot_code: lot, spec_key: spec, unit: l.unit, qty: 0 };
    cur.qty += q; needs.set(key, cur);
  }
  const productIds = [...new Set([...needs.values()].map((n) => n.product_id))];

  // M50: khoá tồn tại vị trí xuất TRONG transaction (2 phiếu khác nhau cùng xác nhận không trừ quá tồn).
  // Khoá theo id cho thứ tự khoá cố định (tránh deadlock), rồi xếp FIFO: lô vào kho sớm nhất trước.
  await lockProducts(client, productIds);
  const { rows: locked } = await client.query(
    `SELECT id, product_id, lot_code, quantity, unit, spec_key, specs, created_at
     FROM inventory_stock
     WHERE product_id = ANY($1::uuid[]) AND location_id = $2 AND quantity > 0
     ORDER BY id FOR UPDATE`,
    [productIds, s.location_id]);
  // Phần phiếu chờ KHÁC đang giữ / kho không xuất được thì không lấy
  const free = new Map((await stockAvailabilityRows(client, productIds, s.id)).map((a) => [a.id, a.available]));
  const fifo = locked
    .map((r) => ({ ...r, left: free.get(r.id) || 0 }))
    .sort((a, b) => (a.created_at - b.created_at) || String(a.lot_code).localeCompare(String(b.lot_code)) || String(a.id).localeCompare(String(b.id)));

  const shortages = [];
  const allocations = []; // { product_id, lot_code, spec_key, specs, quantity, unit }
  // Dòng chỉ định càng cụ thể (lô, thông số) xử lý trước; dòng không chỉ định lấy FIFO trên phần còn lại
  const rank = (n) => (n.lot_code ? 0 : 2) + (n.spec_key ? 0 : 1);
  const ordered = [...needs.values()].sort((a, b) => rank(a) - rank(b));
  for (const n of ordered) {
    const pool = fifo.filter((r) => r.product_id === n.product_id && (!n.lot_code || r.lot_code === n.lot_code)
      && (!n.spec_key || r.spec_key === n.spec_key));
    // Phiếu xuất tay (không phải phiếu NVL của lệnh SX) không chọn thông số mà vị trí có nhiều thông số
    // → không tự đoán (trước đây FIFO lẫn màu → xuất nhầm). Bắt chọn lại khi lập phiếu.
    if (!n.spec_key && !s.prod_order_id) {
      const kinds = [...new Set(pool.filter((r) => r.left > 1e-9).map((r) => r.spec_key))];
      if (kinds.length > 1) {
        const p = (await client.query(`SELECT product_code, product_name FROM products WHERE id = $1`, [n.product_id])).rows[0] || {};
        throw new SlipIssueError(`${p.product_code || ''} ${p.product_name || ''}: vị trí xuất có nhiều thông số (${kinds.map(specLabel).join('; ')}) nhưng dòng phiếu không chọn thông số — vui lòng hủy phiếu và lập lại có chọn thông số.`);
      }
    }
    const onHand = pool.reduce((sum, r) => sum + r.left, 0);
    if (n.qty > onHand + 1e-9) {
      const p = (await client.query(`SELECT product_code, product_name, unit FROM products WHERE id = $1`, [n.product_id])).rows[0] || {};
      shortages.push({ code: p.product_code, name: p.product_name, lot_code: n.lot_code, unit: n.unit || p.unit || '', on_hand: onHand, need: n.qty, buy: n.qty - onHand });
      continue;
    }
    let remain = n.qty;
    for (const sr of pool) {
      if (remain <= 1e-9) break;
      const take = Math.min(remain, sr.left);
      if (take <= 0) continue;
      allocations.push({ product_id: n.product_id, lot_code: sr.lot_code || '', spec_key: sr.spec_key, specs: sr.specs || {}, quantity: take, unit: n.unit || sr.unit });
      sr.left -= take; remain -= take;
    }
  }

  if (shortages.length) {
    const msg = 'Không đủ số lượng khả dụng tại vị trí xuất (đã trừ phần phiếu khác đang giữ):\n' +
      shortages.map((x) => `• ${x.code} ${x.name}${x.lot_code ? ` (lô ${x.lot_code})` : ''}: khả dụng ${x.on_hand} ${x.unit}, cần ${x.need} ${x.unit} → thiếu ${x.buy} ${x.unit}`).join('\n');
    throw new SlipIssueError(msg, { shortages });
  }

  for (const alloc of allocations) {
    // Trừ ĐÚNG dòng tồn đã phân bổ (giữ nguyên spec_key của lô) → không tạo dòng '' ảo
    await applyStock(client, {
      product_id: alloc.product_id, location_id: s.location_id,
      delta: -alloc.quantity, unit: alloc.unit,
      specs: alloc.specs, spec_key: alloc.spec_key, lot_code: alloc.lot_code,
      clampZero: false, trx_type: 'Xuất',
      ref_code: s.slip_code, note: s.purpose || 'Xuất kho',
    });
  }
  return { slip: s, lines, allocations };
}

module.exports = { issueSlipFIFO, SlipIssueError };
