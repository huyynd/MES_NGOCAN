const db = require('../../core/db');
const { applyStock } = require('../../core/lib/stock');

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
  try {
    const { export_date, scrap_warehouse_id, expected_qty, third_party_name, note } = req.body;
    
    // Auto-generate ticket code
    const countRes = await db.query(`SELECT count(*) FROM recycling_tickets`);
    const count = parseInt(countRes.rows[0].count, 10) + 1;
    const ticket_code = `TC-${String(count).padStart(5, '0')}`;

    // Get "Phế phẩm" product ID
    const prodRes = await db.query(`SELECT id FROM products WHERE product_name = 'Phế phẩm' LIMIT 1`);
    const product_id = prodRes.rows[0]?.id || null;

    const query = `
      INSERT INTO recycling_tickets (
        ticket_code, status, export_date, scrap_warehouse_id, expected_qty,
        third_party_name, note, created_by, product_id
      ) VALUES ($1, 'Chờ cân', $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const { rows } = await db.query(query, [
      ticket_code, export_date, scrap_warehouse_id, expected_qty, 
      third_party_name, note, req.user?.username || 'System', product_id
    ]);

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi tạo phiếu tái chế' });
  }
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

    // Tìm location mặc định của kho phế phẩm
    const locRes = await client.query(`SELECT id FROM locations WHERE warehouse_id = $1 LIMIT 1`, [ticket.scrap_warehouse_id]);
    const locationId = locRes.rows[0]?.id || null;

    // Trừ tồn kho phế phẩm QUA applyStock (sổ cái khớp tồn, không đi vòng qua inventory_stock)
    if (actualTotal > 0) {
      const pxCount = await client.query(`SELECT count(*) FROM inventory_transactions WHERE trx_type = 'Xuất'`);
      const pxCode = `PX-${String(parseInt(pxCount.rows[0].count) + 1).padStart(5, '0')}`;
      await applyStock(client, {
        product_id: ticket.product_id, location_id: locationId, delta: -actualTotal, unit: 'Kg',
        specs: {}, lot_code: '', clampZero: false, trx_type: 'Xuất',
        ref_code: pxCode, note: `Xuất phế phẩm đi tái chế (Phiếu ${ticket.ticket_code})`,
      });
    }

    await client.query('COMMIT');
    res.json(ticket);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
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
    console.error(err);
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
    const tQuery = await client.query(`SELECT * FROM recycling_tickets WHERE id = $1 AND status = 'Đang tái chế'`, [ticketId]);
    if (tQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Phiếu không ở trạng thái có thể hoàn thành' });
    }
    const ticket = tQuery.rows[0];

    // Tính hao hụt
    const loss_qty = Number(ticket.expected_qty) - Number(ticket.total_received_qty);

    // Get "Cuộn PE" (Bán thành phẩm) product ID
    const prodRes = await client.query(`SELECT id FROM products WHERE product_name ILIKE 'Cuộn PE' AND product_type = 'Bán thành phẩm' LIMIT 1`);
    const pe_product_id = prodRes.rows[0]?.id || null;

    if (!pe_product_id) {
       await client.query('ROLLBACK');
       return res.status(400).json({ message: 'Không tìm thấy mã sản phẩm Cuộn PE (Bán thành phẩm)' });
    }

    // Cập nhật phiếu hoàn thành
    await client.query(`
      UPDATE recycling_tickets
      SET status = 'Hoàn thành', import_warehouse_id = $1, loss_qty = $2, completed_at = NOW()
      WHERE id = $3
    `, [import_warehouse_id, loss_qty, ticketId]);

    // Tìm location mặc định của kho nhập PE
    const locRes = await client.query(`SELECT id FROM locations WHERE warehouse_id = $1 LIMIT 1`, [import_warehouse_id]);
    const locationId = locRes.rows[0]?.id || null;

    // Nhập kho PE QUA applyStock (sổ cái khớp tồn, không đi vòng qua inventory_stock)
    if (Number(ticket.total_received_qty) > 0) {
      const pnCount = await client.query(`SELECT count(*) FROM inventory_transactions WHERE trx_type = 'Nhập'`);
      const pnCode = `PN-${String(parseInt(pnCount.rows[0].count) + 1).padStart(5, '0')}`;
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
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi hoàn thành phiếu' });
  } finally {
    client.release();
  }
};
