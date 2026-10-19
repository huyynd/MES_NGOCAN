// backend/src/core/lib/codes.js — sinh MÃ CHỨNG TỪ tự tăng tính trong code (PXK…, TC-…).
// D1: trước đây tính MAX(số)+1 không khóa → 2 thao tác cùng lúc lấy trùng mã → lỗi 500 "already exists".
// Nay khóa theo tên bảng (pg_advisory_xact_lock — tự nhả khi transaction COMMIT/ROLLBACK) rồi mới tính MAX,
// nên thao tác sau chờ thao tác trước xong và thấy mã vừa cấp. PHẢI gọi trong transaction (đã BEGIN).

/**
 * nextCode(client, { table, col, prefix, width })
 *   → prefix + số kế tiếp (đệm 0 đủ width), vd 'PXK00012'. Chỉ xét mã đúng dạng ^prefix[0-9]+$.
 */
async function nextCode(client, { table, col, prefix, width = 5 }) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`code:${table}`]);
  const esc = prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const r = await client.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(substr(${col}, $2), '\\D', '', 'g'), '')::bigint), 0) + 1 AS n
       FROM ${table} WHERE ${col} ~ $1`, [`^${esc}[0-9]+$`, prefix.length + 1]);
  return prefix + String(r.rows[0].n).padStart(width, '0');
}

// Phiếu xuất kho PXK00001… — dùng chung cho Xuất kho, Giao hàng, Yêu cầu NVL của LSX
const nextSlipCode = (client) => nextCode(client, { table: 'outbound_slips', col: 'slip_code', prefix: 'PXK', width: 5 });

module.exports = { nextCode, nextSlipCode };
