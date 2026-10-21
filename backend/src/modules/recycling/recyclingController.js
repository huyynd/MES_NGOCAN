const db = require('../../core/db');
const { applyStock, stockErrorResponse } = require('../../core/lib/stock');
const { nextCode } = require('../../core/lib/codes');

// L63: SL PE nhận về được vượt SL phế đã cân tối đa 10% (sai số cân 2 đầu / độ ẩm).
// Vượt quá → gần như chắc nhập nhầm số, chặn để không thổi phồng tồn PE và báo cáo hao hụt.
const RECEIVE_TOLERANCE = 0.10;
// L35: Cuộn PE tái chế được nhập vào kho Bán thành phẩm hoặc kho NVL (dùng lại làm hạt).
const PE_IMPORT_WAREHOUSE_TYPES = ['BTP', 'NVL'];

// Trả thông báo lỗi nếu SL nhận vượt dung sai so với SL cân, ngược lại null.
function receivedOverTolerance(expectedQty, receivedQty) {
  const expected = Number(expectedQty) || 0;
  const max = expected * (1 + RECEIVE_TOLERANCE);
  if (receivedQty > max + 1e-6) {
    return `SL PE nhận (${receivedQty} kg) vượt quá SL phế đã cân (${expected} kg) + ${RECEIVE_TOLERANCE * 100}% (tối đa ${Math.round(max * 1000) / 1000} kg) — kiểm tra lại số cân.`;
  }
  return null;
}

exports.list = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT r.*, w.name as scrap_warehouse_name
      FROM recycling_tickets r
      LEFT JOIN warehouses w ON r.scrap_warehouse_id = w.id
      ORDER BY r.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lấy danh sách phiếu' });
  }
};

exports.getById = async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { rows: tickets } = await db.query(`
      SELECT r.*, w.name as scrap_warehouse_name,
             iw.name as import_warehouse_name
      FROM recycling_tickets r
      LEFT JOIN warehouses w ON r.scrap_warehouse_id = w.id
      LEFT JOIN warehouses iw ON r.import_warehouse_id = iw.id
      WHERE r.id = $1
    `, [ticketId]);
    
    if (tickets.length === 0) return res.status(404).json({ message: 'Không tìm thấy phiếu' });

    const { rows: rolls } = await db.query(`
      SELECT * FROM recycling_rolls WHERE ticket_id = $1 ORDER BY created_at ASC
    `, [ticketId]);

    const ticket = tickets[0];
    ticket.rolls = rolls;
    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi chi tiết phiếu' });
  }
};

exports.create = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { export_date, scrap_warehouse_id, expected_qty, third_party_name, note } = req.body;
    // Phiếu không sửa được sau khi tạo → thiếu kho phế thì phiếu kẹt ở bước cân. Bắt chọn ngay khi tạo.
    if (!scrap_warehouse_id) return res.status(400).json({ message: 'Vui lòng chọn kho phế phẩm.' });

    await client.query('BEGIN');
    // D1: mã TC-xxxxx = MAX + 1 có khóa (trước đây COUNT(*)+1 → trùng khi tạo đồng thời / sau khi xóa phiếu)
    const ticket_code = await nextCode(client, { table: 'recycling_tickets', col: 'ticket_code', prefix: 'TC-', width: 5 });

    // Get "Phế phẩm" product ID
    const prodRes = await client.query(`SELECT id FROM products WHERE product_name = 'Phế phẩm' LIMIT 1`);
    const product_id = prodRes.rows[0]?.id || null;

    const query = `
      INSERT INTO recycling_tickets (
        ticket_code, status, export_date, scrap_warehouse_id, expected_qty,
        third_party_name, note, created_by, product_id
      ) VALUES ($1, 'Chờ cân', $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const { rows } = await client.query(query, [
      ticket_code, export_date, scrap_warehouse_id, expected_qty,
      third_party_name, note, req.user?.username || 'System', product_id
    ]);
    await client.query('COMMIT');

    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi tạo phiếu tái chế' });
  } finally { client.release(); }
};

exports.weigh = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const ticketId = req.params.id;
    const { internal_scrap_qty, mixed_scrap_qty, weighing_person } = req.body;

    const internal = Number(internal_scrap_qty) || 0;
    const mixed = Number(mixed_scrap_qty) || 0;
    const actualTotal = internal + mixed;
    // Kiểm số lượng đầu vào
    if (internal < 0 || mixed < 0) return res.status(400).json({ message: 'Số lượng cân không được âm.' });

    // Begin transaction for inventory export — dùng 1 connection riêng (client) cho cả BEGIN…COMMIT
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE recycling_tickets
      SET internal_scrap_qty = $1, mixed_scrap_qty = $2, expected_qty = $3,
          weighing_person = $4, weighing_time = NOW(), status = 'Đang tái chế'
      WHERE id = $5 AND status = 'Chờ cân'
      RETURNING *
    `;
    const { rows } = await client.query(updateQuery, [internal, mixed, actualTotal, weighing_person, ticketId]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Phiếu không tồn tại hoặc đã qua bước cân' });
    }

    const ticket = rows[0];

    // Cấu hình sản phẩm "Phế phẩm" phải có (tránh lỗi mơ hồ do tra theo tên)
    if (!ticket.product_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Chưa cấu hình sản phẩm "Phế phẩm" trong danh mục — không thể ghi xuất kho.' });
    }

    // Phiếu chưa chọn kho phế → báo rõ (trước đây trừ tồn ở vị trí NULL → báo nhầm "tồn 0")
    if (!ticket.scrap_warehouse_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Chưa chọn kho phế phẩm cho phiếu — không thể trừ tồn phế. Hãy tạo phiếu mới có chọn kho phế phẩm.' });
    }

    // K-13: trừ ở các vị trí THỰC CÓ tồn phế trong kho phế (vị trí còn hoạt động), nhiều hàng nhất trước —
    // trước đây lấy 1 vị trí bất kỳ (có thể trống / đã xóa) → báo "tồn 0 — thiếu" dù kho có hàng.
    const { rows: stockRows } = await client.query(
      `SELECT s.location_id, s.spec_key, s.specs, s.lot_code, s.quantity
         FROM inventory_stock s JOIN locations l ON l.id = s.location_id
        WHERE l.warehouse_id = $1 AND l.is_deleted = FALSE AND s.product_id = $2 AND s.quantity > 0
        ORDER BY s.quantity DESC, s.created_at, s.id FOR UPDATE OF s`,
      [ticket.scrap_warehouse_id, ticket.product_id]);
    const onHand = stockRows.reduce((sum, r) => sum + Number(r.quantity), 0);
    if (actualTotal > onHand + 1e-9) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Không đủ tồn phế phẩm trong kho phế — tồn ${onHand.toLocaleString('vi-VN')} kg, cần xuất ${actualTotal.toLocaleString('vi-VN')} kg, thiếu ${(actualTotal - onHand).toLocaleString('vi-VN')} kg.` });
    }

    // Trừ tồn kho phế phẩm QUA applyStock (sổ cái khớp tồn, không đi vòng qua inventory_stock)
    if (actualTotal > 0) {
      // K-14: mã PX- = MAX + 1 có khóa (trước đây COUNT(*)+1 không khóa → cân đồng thời trùng mã)
      const pxCode = await nextCode(client, { table: 'inventory_transactions', col: 'ref_code', prefix: 'PX-', width: 5 });
      let remain = actualTotal;
      for (const r of stockRows) {
        if (remain <= 1e-9) break;
        const take = Math.min(remain, Number(r.quantity));
        await applyStock(client, {
          product_id: ticket.product_id, location_id: r.location_id, delta: -take, unit: 'Kg',
          specs: r.specs || {}, spec_key: r.spec_key, lot_code: r.lot_code || '', clampZero: false, trx_type: 'Xuất',
          ref_code: pxCode, note: `Xuất phế phẩm đi tái chế (Phiếu ${ticket.ticket_code})`,
        });
        remain -= take;
      }
    }

    await client.query('COMMIT');
    res.json(ticket);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); if (stockErrorResponse(res, err)) return;
    res.status(500).json({ message: 'Lỗi khi ghi nhận cân' });
  } finally {
    client.release();
  }
};

exports.receiveRolls = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const ticketId = req.params.id;
    const { rolls } = req.body;

    await client.query('BEGIN');

    // L44: chỉ ghi nhận cuộn khi phiếu "Đang tái chế" — sau Hoàn thành, kho PE đã nhập theo tổng nhận cũ,
    // sửa cuộn lúc đó làm phiếu / kho / hao hụt lệch nhau. FOR UPDATE: không chạy song song với "Hoàn thành".
    const t = (await client.query(
      `SELECT status, expected_qty FROM recycling_tickets WHERE id = $1 FOR UPDATE`, [ticketId])).rows[0];
    if (!t) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Không tìm thấy phiếu' }); }
    if (t.status !== 'Đang tái chế') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Phiếu đang "${t.status}" — chỉ ghi nhận cuộn PE khi phiếu "Đang tái chế".` });
    }
    if (!Array.isArray(rolls) || !rolls.length || rolls.some((r) => !r || !Number.isFinite(Number(r.weight)) || Number(r.weight) < 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Danh sách cuộn trống hoặc có cuộn khối lượng không hợp lệ (phải là số ≥ 0).' });
    }
    // L63: kiểm dung sai ngay khi ghi nhận (báo sai sớm), chặn lại lần nữa ở bước Hoàn thành
    const overMsg = receivedOverTolerance(t.expected_qty, rolls.reduce((s, r) => s + Number(r.weight), 0));
    if (overMsg) { await client.query('ROLLBACK'); return res.status(400).json({ message: overMsg }); }

    // Xóa cuộn cũ nếu có (để update)
    await client.query(`DELETE FROM recycling_rolls WHERE ticket_id = $1`, [ticketId]);

    // Thêm cuộn mới
    let total_received = 0;
    for (let i = 0; i < rolls.length; i++) {
      const r = rolls[i];
      const roll_code = `PE-${ticketId.split('-')[0]}-${String(i + 1).padStart(2, '0')}`;
      const weight = Number(r.weight) || 0;
      total_received += weight;

      await client.query(`
        INSERT INTO recycling_rolls (ticket_id, roll_code, pe_type, weight, unit, note)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [ticketId, roll_code, r.pe_type, weight, r.unit || 'kg', r.note]);
    }

    // Cập nhật lại tổng nhận vào phiếu (chưa hoàn thành)
    await client.query(`
      UPDATE recycling_tickets
      SET total_received_qty = $1
      WHERE id = $2
    `, [total_received, ticketId]);

    await client.query('COMMIT');
    res.json({ success: true, total_received });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); if (stockErrorResponse(res, err)) return;
    res.status(500).json({ message: 'Lỗi khi ghi nhận cuộn PE' });
  } finally {
    client.release();
  }
};

exports.complete = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const ticketId = req.params.id;
    const { import_warehouse_id } = req.body;

    await client.query('BEGIN');

    // Lấy thông tin phiếu
    const tQuery = await client.query(`SELECT * FROM recycling_tickets WHERE id = $1 AND status = 'Đang tái chế' FOR UPDATE`, [ticketId]);
    if (tQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Phiếu không ở trạng thái có thể hoàn thành' });
    }
    const ticket = tQuery.rows[0];

    // L63: chặn cuối — SL nhận đã lưu không được vượt SL cân quá dung sai
    const overMsg = receivedOverTolerance(ticket.expected_qty, Number(ticket.total_received_qty) || 0);
    if (overMsg) { await client.query('ROLLBACK'); return res.status(400).json({ message: overMsg }); }

    // L35: bắt buộc kho nhập hợp lệ (đúng loại, có vị trí). Trước đây thiếu kho → tồn PE ghi location NULL:
    // không hiện ở cây kho, không xuất/giao được.
    if (!import_warehouse_id) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Vui lòng chọn kho nhập Cuộn PE.' }); }
    const wh = (await client.query(
      `SELECT w.warehouse_type, l.id AS location_id
       FROM warehouses w
       LEFT JOIN locations l ON l.warehouse_id = w.id AND l.is_deleted = FALSE
       WHERE w.id = $1 AND w.is_deleted = FALSE
       ORDER BY l.created_at LIMIT 1`, [import_warehouse_id])).rows[0];
    if (!wh) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Kho nhập không tồn tại.' }); }
    if (!PE_IMPORT_WAREHOUSE_TYPES.includes(wh.warehouse_type)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `Cuộn PE chỉ nhập vào kho ${PE_IMPORT_WAREHOUSE_TYPES.join(' hoặc ')} (kho đã chọn: ${wh.warehouse_type}).` });
    }
    if (!wh.location_id) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Kho nhập chưa có vị trí — hãy tạo vị trí kho trước.' }); }

    // Tính hao hụt
    const loss_qty = Number(ticket.expected_qty) - Number(ticket.total_received_qty);

    // SP nhận cuộn PE tái chế: cấu hình ở app_settings.recycled_pe_product_id (jsonb chứa chuỗi uuid),
    // không tra theo tên/loại SP (trước đây tìm 'Cuộn PE' + loại 'Bán thành phẩm' → không bao giờ khớp).
    const prodRes = await client.query(
      `SELECT p.id FROM app_settings a
       JOIN products p ON p.id::text = a.value #>> '{}' AND p.is_deleted = FALSE
       WHERE a.key = 'recycled_pe_product_id'`);
    const pe_product_id = prodRes.rows[0]?.id || null;

    if (!pe_product_id) {
       await client.query('ROLLBACK');
       return res.status(400).json({ message: 'Chưa cấu hình sản phẩm nhận cuộn PE tái chế (app_settings.recycled_pe_product_id), hoặc sản phẩm đó đã bị xóa.' });
    }

    // Cập nhật phiếu hoàn thành
    await client.query(`
      UPDATE recycling_tickets
      SET status = 'Hoàn thành', import_warehouse_id = $1, loss_qty = $2, completed_at = NOW()
      WHERE id = $3
    `, [import_warehouse_id, loss_qty, ticketId]);

    // Vị trí mặc định của kho nhập PE (đã kiểm ở trên: luôn có)
    const locationId = wh.location_id;

    // Nhập kho PE QUA applyStock (sổ cái khớp tồn, không đi vòng qua inventory_stock)
    if (Number(ticket.total_received_qty) > 0) {
      // K-14: MAX + 1 có khóa (trước đây COUNT(*)+1 → trùng mã khi đồng thời)
      const pnCode = await nextCode(client, { table: 'inventory_transactions', col: 'ref_code', prefix: 'PN-', width: 5 });
      await applyStock(client, {
        product_id: pe_product_id, location_id: locationId, delta: Number(ticket.total_received_qty), unit: 'Kg',
        specs: {}, lot_code: '', clampZero: false, trx_type: 'Nhập',
        ref_code: pnCode, note: `Nhập kho PE tái chế từ phiếu ${ticket.ticket_code}`,
      });
    }

    await client.query('COMMIT');
    res.json({ success: true, loss_qty });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); if (stockErrorResponse(res, err)) return;
    res.status(500).json({ message: 'Lỗi khi hoàn thành phiếu' });
  } finally {
    client.release();
  }
};
