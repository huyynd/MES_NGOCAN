// backend/src/core/lib/rolls.js — TỒN KHO THEO CUỘN (spec docs/ai/specs/2026-11-13-ton-kho-theo-cuon.md)
// MỘT NƠI DUY NHẤT chứa logic cuộn con dưới lô LSX. Mọi hàm nhận `client` ĐANG trong transaction.
//  - Lô = (product_id, location_id, spec_key, lot_code) — cùng khóa với inventory_stock.
//  - Tổng còn của cuộn ≤ số lô; phần chênh = "Không rõ cuộn" (hàng cũ / nhập điều chỉnh), tính khi đọc (Q1).
//  - Trừ lô (applyStock delta < 0) → trimRolls: trừ "Không rõ cuộn" trước rồi cuộn số nhỏ nhất (001→n) (QT3, Q1, Q3, Q4).
//  - Lô không có cuộn → không làm gì (QT4).

const STAGE_NO = { 'Thổi': 1, 'Cắt': 2 };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const EPS = 1e-6;

const LOT_WHERE = (o = 1) =>
  `product_id = $${o} AND location_id IS NOT DISTINCT FROM $${o + 1} AND spec_key = $${o + 2} AND lot_code = $${o + 3}`;
const lotParams = (lot) => [lot.product_id, lot.location_id || null, lot.spec_key, lot.lot_code || ''];
// Thứ tự cuộn theo SỐ (…_999 trước …_1000), khóa phụ ổn định theo id
const ROLL_ORDER = 'length(roll_code), roll_code, id';

/** Cấp mã cuộn mới cho 1 dòng công đoạn: {order_code}_{1|2}_{xxx}. Bộ đếm bền — số đã cấp không dùng lại (QT2). */
async function allocRollCode(client, poId, stage) {
  const no = STAGE_NO[stage];
  if (!no) throw new Error(`Công đoạn "${stage}" không có mã cuộn.`);
  const r = (await client.query(
    `WITH c AS (
       INSERT INTO production_roll_counters (production_order_id, stage, last_no) VALUES ($1, $2, 1)
       ON CONFLICT (production_order_id, stage) DO UPDATE SET last_no = production_roll_counters.last_no + 1
       RETURNING last_no)
     SELECT po.order_code, c.last_no FROM c, production_orders po WHERE po.id = $1`, [poId, no])).rows[0];
  if (!r) throw new Error('Không tìm thấy lệnh sản xuất để cấp mã cuộn.');
  return `${r.order_code}_${no}_${String(r.last_no).padStart(3, '0')}`;
}

/**
 * Thêm (cộng dồn) một cuộn vào lô. Gọi SAU applyStock nhập lô tương ứng, cùng transaction (dòng lô đã bị khóa).
 * Bất biến tổng cuộn ≤ số lô: chỉ thêm tối đa (số lô − tổng cuộn đang có). Lô âm từ dữ liệu cũ (vd −50, nhập 100 → lô 50)
 * thì cuộn chỉ nhận 50 — nếu không, Cắt / chuyển kho sẽ báo dùng cuộn nhiều hơn số thật. Trả số đã thêm vào cuộn.
 */
async function addRoll(client, lot, { roll_code, stage, qty, specs = {}, task_code = null }) {
  if (!roll_code || !(round2(qty) > 0)) return 0;
  const room = Number((await client.query(
    `SELECT COALESCE((SELECT quantity FROM inventory_stock WHERE ${LOT_WHERE()}), 0)
          - COALESCE((SELECT SUM(qty_remaining) FROM inventory_rolls WHERE ${LOT_WHERE()}), 0) AS room`, lotParams(lot))).rows[0].room);
  const q = round2(Math.min(round2(qty), Math.max(room, 0)));
  if (!(q > 0)) return 0;
  const up = await client.query(
    `UPDATE inventory_rolls SET qty_initial = qty_initial + $5, qty_remaining = qty_remaining + $5, updated_at = now()
      WHERE ${LOT_WHERE()} AND roll_code = $6`, [...lotParams(lot), q, roll_code]);
  if (up.rowCount) return q;
  await client.query(
    `INSERT INTO inventory_rolls (product_id, location_id, spec_key, lot_code, roll_code, stage, qty_initial, qty_remaining, specs, task_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8::jsonb,$9)`,
    [...lotParams(lot), roll_code, stage, q, JSON.stringify(specs || {}), task_code]);
  return q;
}

/**
 * Sau khi lô bị trừ còn `lotQty`: cắt bớt cuộn sao cho tổng còn ≤ lotQty, lấy từ cuộn số nhỏ nhất.
 * Phần "Không rõ cuộn" (lô − tổng cuộn) tự bị trừ trước vì chỉ phần vượt mới rơi vào cuộn.
 * Khóa các cuộn (FOR UPDATE theo thứ tự cố định). Trả [{ roll_code, qty }] đã trừ — tổng KHÔNG vượt `cap` (= số lô thật
 * vừa bị trừ). Cuộn vượt lô sẵn (dữ liệu xấu) vẫn bị cắt về ≤ lô, nhưng phần cắt thêm đó không báo là đã dùng, để
 * Hủy hoàn thành / chuyển kho không hoàn / chuyển nhiều hơn số thật.
 */
async function trimRolls(client, lot, lotQty, cap = Infinity) {
  const rows = (await client.query(
    `SELECT id, roll_code, qty_remaining FROM inventory_rolls
      WHERE ${LOT_WHERE()} AND qty_remaining > 0 ORDER BY ${ROLL_ORDER} FOR UPDATE`, lotParams(lot))).rows;
  if (!rows.length) return [];
  let excess = round2(rows.reduce((s, r) => s + Number(r.qty_remaining), 0) - Math.max(Number(lotQty) || 0, 0));
  let left = Math.max(Number(cap), 0);
  const used = [];
  for (const r of rows) {
    if (excess <= EPS) break;
    const take = round2(Math.min(Number(r.qty_remaining), excess));
    await client.query(`UPDATE inventory_rolls SET qty_remaining = qty_remaining - $2, updated_at = now() WHERE id = $1`, [r.id, take]);
    const counted = round2(Math.min(take, left));
    if (counted > EPS) used.push({ roll_code: r.roll_code, qty: counted });
    left = round2(left - counted);
    excess = round2(excess - take);
  }
  return used;
}

/** Hoàn lại đúng các cuộn đã trừ (hủy hoàn thành). Gọi SAU applyStock cộng lại lô. Cuộn không còn → phần đó thành "Không rõ cuộn". */
async function restoreRolls(client, lot, used = []) {
  for (const u of used) {
    const q = round2(u.qty);
    if (!u.roll_code || !(q > 0)) continue;
    await client.query(
      `UPDATE inventory_rolls SET qty_remaining = LEAST(qty_initial, qty_remaining + $5), updated_at = now()
        WHERE ${LOT_WHERE()} AND roll_code = $6`, [...lotParams(lot), q, u.roll_code]);
  }
}

/** Chuyển kho: phần cuộn đã trừ ở lô nguồn (`used` từ applyStock) đi sang lô đích; cuộn chuyển hết thì bỏ khỏi nguồn (Q3). */
async function moveRolls(client, fromLot, toLot, used = []) {
  for (const u of used) {
    const q = round2(u.qty);
    if (!u.roll_code || !(q > 0)) continue;
    const src = (await client.query(
      `UPDATE inventory_rolls SET qty_initial = GREATEST(qty_initial - $5, 0), updated_at = now()
        WHERE ${LOT_WHERE()} AND roll_code = $6 RETURNING stage, specs, task_code, qty_initial, qty_remaining`,
      [...lotParams(fromLot), q, u.roll_code])).rows[0];
    if (!src) continue;
    if (Number(src.qty_initial) <= EPS && Number(src.qty_remaining) <= EPS) {
      await client.query(`DELETE FROM inventory_rolls WHERE ${LOT_WHERE()} AND roll_code = $5`, [...lotParams(fromLot), u.roll_code]);
    }
    await addRoll(client, toLot, { roll_code: u.roll_code, stage: src.stage, qty: q, specs: src.specs, task_code: src.task_code });
  }
}

/** Bỏ một cuộn khỏi lô (hủy hoàn thành). Trả cuộn đã bỏ hoặc null. Gọi TRƯỚC applyStock trừ lô để phần trừ rơi đúng vào nó. */
async function removeRoll(client, lot, rollCode) {
  if (!rollCode) return null;
  return (await client.query(
    `DELETE FROM inventory_rolls WHERE ${LOT_WHERE()} AND roll_code = $5 RETURNING roll_code, qty_initial, qty_remaining`,
    [...lotParams(lot), rollCode])).rows[0] || null;
}

const STAGE_NAME = { 1: 'Thổi', 2: 'Cắt' };

/**
 * Sổ cuộn: ghi các cuộn vừa bị trừ bởi MỘT giao dịch kho (applyStock gọi, cùng transaction) → khách trả hàng / đảo phiếu
 * biết cộng về cuộn nào. used = [{ roll_code, qty }] từ trimRolls.
 */
async function recordRollMoves(client, lot, used, { trx_id = null, trx_type = null, ref_code = null } = {}) {
  for (const u of used) {
    const q = round2(u.qty);
    if (!u.roll_code || !(q > 0)) continue;
    await client.query(
      `INSERT INTO inventory_roll_moves (trx_id, product_id, location_id, spec_key, lot_code, roll_code, qty, trx_type, ref_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [trx_id, ...lotParams(lot), u.roll_code, -q, trx_type, ref_code]);
  }
}

/** Công đoạn cuộn của lô (1 Thổi / 2 Cắt): theo cuộn đang có của lô; không còn cuộn → theo loại kho nhận (TP = Cắt, BTP = Thổi). */
async function lotStage(client, lot) {
  const k = [lot.product_id, lot.spec_key, lot.lot_code || ''];
  const st = (await client.query(
    `SELECT stage FROM inventory_rolls WHERE product_id = $1 AND spec_key = $2 AND lot_code = $3
      ORDER BY (location_id IS NOT DISTINCT FROM $4) DESC, created_at DESC LIMIT 1`, [...k, lot.location_id || null])).rows[0]?.stage
    // Cuộn của lô đã bỏ hết (vd chuyển kho hết) → theo loại kho nhận: TP = Cắt, BTP = Thổi
    || { TP: 2, BTP: 1 }[(await client.query(
      `SELECT w.warehouse_type FROM locations l JOIN warehouses w ON w.id = l.warehouse_id WHERE l.id = $1`, [lot.location_id || null])).rows[0]?.warehouse_type];
  return st ? Number(st) : null;
}

/** Mã cuộn mới cho hàng trả không rõ cuộn gốc: LSX của lô (mã lô = mã LSX, rồi prod_order_id) + công đoạn của lô. */
async function newRollTarget(client, lot) {
  const k = [lot.product_id, lot.spec_key, lot.lot_code || ''];
  const st = await lotStage(client, lot);
  if (!st) return null;
  const poId = (await client.query(
    `SELECT COALESCE(
       (SELECT id FROM production_orders WHERE order_code = $3 ORDER BY is_deleted, created_at LIMIT 1),
       (SELECT prod_order_id FROM inventory_stock WHERE product_id = $1 AND spec_key = $2 AND lot_code = $3 AND prod_order_id IS NOT NULL LIMIT 1)
     ) AS id`, k)).rows[0]?.id;
  return poId ? { poId, stage: st } : null;
}

/**
 * Hàng quay lại kho từ một giao dịch xuất (khách trả hàng, đảo phiếu xuất DPX, trả NVL / hủy LSX): gọi SAU applyStock nhập
 * lô nhận, cùng transaction (dòng lô đã khóa). Cổng B 2026-11-17 câu 3:
 *  - cộng về ĐÚNG các cuộn mà giao dịch gốc đã trừ (ngược thứ tự đã trừ), mỗi cuộn tối đa phần đã trừ trừ phần đã trả trước đó;
 *  - nhận ở vị trí khác vị trí đã xuất → phần đó mang mã cuộn gốc sang lô nhận (cuộn ở lô cũ giữ nguyên số, không khóa chéo lô);
 *  - phần còn lại (không rõ cuộn gốc) → MỘT mã cuộn mới {LSX}_{1|2}_{xxx} theo bộ đếm bền — chỉ khi lô có cuộn; lô cũ không
 *    cuộn giữ như cũ; lô không gắn được LSX → để "Không rõ cuộn".
 * Bất biến tổng cuộn ≤ số lô giữ như addRoll. Trả [{ roll_code, qty, new }] đã cộng vào cuộn.
 */
async function returnRolls(client, lot, { source_trx_id, qty, trx_id = null, trx_type = null, ref_code = null, specs = {} }) {
  if (!source_trx_id || !lot.lot_code || !(round2(qty) > 0)) return [];
  const p = lotParams(lot);
  const room = Number((await client.query(
    `SELECT COALESCE((SELECT quantity FROM inventory_stock WHERE ${LOT_WHERE()}), 0)
          - COALESCE((SELECT SUM(qty_remaining) FROM inventory_rolls WHERE ${LOT_WHERE()}), 0) AS room`, p)).rows[0].room);
  let left = round2(Math.min(round2(qty), Math.max(room, 0)));
  const out = [];
  const log = (roll_code, q, sourceMoveId) => client.query(
    `INSERT INTO inventory_roll_moves (trx_id, product_id, location_id, spec_key, lot_code, roll_code, qty, source_move_id, trx_type, ref_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [trx_id, ...p, roll_code, q, sourceMoveId, trx_type, ref_code]);

  // Khóa các dòng trừ của giao dịch gốc trước (2 lần trả cùng nguồn xếp hàng), rồi mới đọc phần đã trả (câu sau = số mới)
  const ids = (await client.query(
    `SELECT id FROM inventory_roll_moves WHERE trx_id = $1 AND qty < 0 ORDER BY id DESC FOR UPDATE`, [source_trx_id])).rows.map((r) => r.id);
  const moves = ids.length ? (await client.query(
    `SELECT m.id, m.location_id, m.roll_code, -m.qty AS out_qty,
            COALESCE((SELECT SUM(r.qty) FROM inventory_roll_moves r WHERE r.source_move_id = m.id), 0) AS back
       FROM inventory_roll_moves m WHERE m.id = ANY($1::bigint[]) ORDER BY m.id DESC`, [ids])).rows : [];
  for (const m of moves) {
    if (left <= EPS) break;
    let take = round2(Math.min(left, Number(m.out_qty) - Number(m.back)));
    if (!(take > EPS)) continue;
    const here = (await client.query(
      `SELECT id, stage, specs, task_code, qty_initial, qty_remaining FROM inventory_rolls WHERE ${LOT_WHERE()} AND roll_code = $5 FOR UPDATE`, [...p, m.roll_code])).rows[0];
    if (here) {
      // Lấp phần trống của cuộn gốc ở lô nhận trước; phần còn lại (cuộn đến đây bằng chuyển kho, đã đầy) vẫn là cuộn gốc
      // → cộng vào chính cuộn đó (qty_initial + qty_remaining, addRoll chặn theo số lô), như nhánh dưới — không cấp mã mới.
      const fill = round2(Math.max(Math.min(take, Number(here.qty_initial) - Number(here.qty_remaining)), 0));
      if (fill > EPS) await client.query(`UPDATE inventory_rolls SET qty_remaining = qty_remaining + $2, updated_at = now() WHERE id = $1`, [here.id, fill]);
      const extra = round2(take - fill) > EPS
        ? await addRoll(client, lot, { roll_code: m.roll_code, stage: here.stage, qty: round2(take - fill), specs: here.specs, task_code: here.task_code })
        : 0;
      take = round2(fill + extra);
    } else {
      // Nhận ở vị trí khác (hoặc cuộn đã rời lô này): mang mã cuộn gốc sang lô nhận. Chỉ ĐỌC cuộn ở lô cũ (không khóa / sửa)
      // để không khóa chéo sang lô khác — tránh deadlock với chuyển kho chạy cùng lúc giữa 2 vị trí này.
      const src = (await client.query(`SELECT stage, specs, task_code FROM inventory_rolls WHERE ${LOT_WHERE()} AND roll_code = $5`,
        [...lotParams({ ...lot, location_id: m.location_id }), m.roll_code])).rows[0];
      const stage = src?.stage || await lotStage(client, lot);
      take = stage ? await addRoll(client, lot, { roll_code: m.roll_code, stage, qty: take, specs: src?.specs || specs, task_code: src?.task_code || null }) : 0;
    }
    if (!(take > EPS)) continue;
    await log(m.roll_code, take, m.id);
    out.push({ roll_code: m.roll_code, qty: take, new: false });
    left = round2(left - take);
  }

  if (left > EPS) {
    const hasRolls = moves.length > 0 || (await client.query(
      `SELECT 1 FROM inventory_rolls WHERE product_id = $1 AND spec_key = $2 AND lot_code = $3 LIMIT 1`, [lot.product_id, lot.spec_key, lot.lot_code])).rowCount > 0;
    const target = hasRolls ? await newRollTarget(client, lot) : null;
    if (target) {
      const code = await allocRollCode(client, target.poId, STAGE_NAME[target.stage]);
      const q = await addRoll(client, lot, { roll_code: code, stage: target.stage, qty: left, specs });
      if (q > EPS) { await log(code, q, null); out.push({ roll_code: code, qty: q, new: true }); }
    } else if (hasRolls) {
      console.warn(`[Cuộn] Hàng trả ${left} vào lô ${lot.lot_code}: không xác định được LSX của lô → để "Không rõ cuộn".`);
    }
  }
  return out;
}

/**
 * Hủy hoàn thành: khóa dòng lô (FOR UPDATE) RỒI mới khóa cuộn — cùng thứ tự với applyStock (lô → cuộn), để không deadlock
 * và không kiểm trên số cũ khi Cắt / xuất / giao / chuyển kho chạy cùng lúc. Trả { lot_qty (null nếu chưa có dòng lô), roll }.
 */
async function lockLotRoll(client, lot, rollCode) {
  const s = (await client.query(`SELECT quantity FROM inventory_stock WHERE ${LOT_WHERE()} FOR UPDATE`, lotParams(lot))).rows[0];
  const roll = rollCode
    ? (await client.query(`SELECT * FROM inventory_rolls WHERE ${LOT_WHERE()} AND roll_code = $5 FOR UPDATE`, [...lotParams(lot), rollCode])).rows[0] || null
    : null;
  return { lot_qty: s ? Number(s.quantity) : null, roll };
}

/** Cuộn còn NGUYÊN ở đúng lô đã nhập: có, chưa bị trừ, và ban đầu ≥ số đã nhập (không phần nào bị cắt / chuyển kho / xuất / giao). */
const rollIntact = (roll, postedQty) => !!roll
  && Number(roll.qty_remaining) >= Number(roll.qty_initial) - EPS
  && Number(roll.qty_initial) >= Number(postedQty) - EPS;

/** Đọc một cuộn của lô (không khóa). */
async function getRoll(client, lot, rollCode) {
  return (await client.query(`SELECT * FROM inventory_rolls WHERE ${LOT_WHERE()} AND roll_code = $5`, [...lotParams(lot), rollCode])).rows[0] || null;
}

/**
 * Gộp cuộn bị trừ khi Cắt (phần cắt `take` + phần hao hụt "đã hết cuộn" `off`) thành dòng ghi production_roll_usage:
 * [{ roll_code, used, off }]; phần không rơi vào cuộn nào → roll_code null ("Không rõ cuộn"). Không có cuộn → 1 dòng null như cũ.
 */
function splitUsage(take, off, usedTake = [], usedOff = []) {
  const m = new Map();
  const put = (code, k, q) => { const r = m.get(code) || { roll_code: code, used: 0, off: 0 }; r[k] = round2(r[k] + q); m.set(code, r); };
  usedTake.forEach((u) => put(u.roll_code, 'used', u.qty));
  usedOff.forEach((u) => put(u.roll_code, 'off', u.qty));
  const sum = (k) => [...m.values()].reduce((s, r) => s + r[k], 0);
  const restUsed = round2(take - sum('used')), restOff = round2(off - sum('off'));
  const rows = [...m.values()];
  if (restUsed > EPS || restOff > EPS || !rows.length) rows.push({ roll_code: null, used: Math.max(restUsed, 0), off: Math.max(restOff, 0) });
  return rows;
}

const rollStatus = (r) => {
  const rem = Number(r.qty_remaining), ini = Number(r.qty_initial);
  if (rem <= EPS) return 'Hết';
  if (rem < ini - EPS) return 'Đang cắt dở';
  return 'Còn';
};

/** Danh sách cuộn của lô + số lô + phần "Không rõ cuộn". */
async function listRolls(client, lot) {
  const p = lotParams(lot);
  const rows = (await client.query(
    `SELECT roll_code, stage, qty_initial::float8 AS qty_initial, qty_remaining::float8 AS qty_remaining, specs, task_code, created_at
       FROM inventory_rolls WHERE ${LOT_WHERE()} ORDER BY ${ROLL_ORDER}`, p)).rows;
  const lotQty = Number((await client.query(`SELECT quantity FROM inventory_stock WHERE ${LOT_WHERE()}`, p)).rows[0]?.quantity || 0);
  const sum = rows.reduce((s, r) => s + Number(r.qty_remaining), 0);
  return {
    lot_qty: lotQty,
    unknown_qty: rows.length ? Math.max(round2(lotQty - sum), 0) : 0,
    rolls: rows.map((r) => ({ ...r, status: rollStatus(r) })),
  };
}

/**
 * XEM TRƯỚC cuộn sẽ bị trừ (chỉ đọc, không khóa/ghi): mô phỏng đúng trimRolls cho danh sách phần trừ
 * [{product_id, location_id, spec_key, lot_code, quantity}]. Nhiều phần cùng lô → trừ nối tiếp.
 * Trả [{product_id, location_id, spec_key, lot_code, roll_code, qty}].
 */
async function previewRolls(q, takes) {
  const byLot = new Map();
  for (const t of takes) {
    const k = [t.product_id, t.location_id || '', t.spec_key, t.lot_code || ''].join('|');
    const g = byLot.get(k) || { lot: t, take: 0 }; g.take = round2(g.take + Number(t.quantity || 0)); byLot.set(k, g);
  }
  const out = [];
  for (const { lot, take } of byLot.values()) {
    const rows = (await q.query(
      `SELECT roll_code, qty_remaining FROM inventory_rolls WHERE ${LOT_WHERE()} AND qty_remaining > 0 ORDER BY ${ROLL_ORDER}`, lotParams(lot))).rows;
    if (!rows.length) continue;
    const lotQty = Number((await q.query(`SELECT COALESCE((SELECT quantity FROM inventory_stock WHERE ${LOT_WHERE()}), 0) AS q`, lotParams(lot))).rows[0].q);
    let excess = round2(rows.reduce((s, r) => s + Number(r.qty_remaining), 0) - Math.max(lotQty - take, 0));
    let left = Math.max(take, 0);
    for (const r of rows) {
      if (excess <= EPS) break;
      const t = round2(Math.min(Number(r.qty_remaining), excess));
      const counted = round2(Math.min(t, left));
      if (counted > EPS) out.push({ product_id: lot.product_id, location_id: lot.location_id, spec_key: lot.spec_key, lot_code: lot.lot_code || '', roll_code: r.roll_code, qty: counted });
      left = round2(left - counted); excess = round2(excess - t);
    }
  }
  return out;
}

module.exports = {
  STAGE_NO, allocRollCode, addRoll, trimRolls, splitUsage, restoreRolls, moveRolls, removeRoll, getRoll, listRolls, rollStatus,
  lockLotRoll, rollIntact, recordRollMoves, returnRolls, previewRolls,
};
