// backend/src/modules/sales/importController.js
// POST /import/orders — Nhận file Excel, parse và nhập đơn hàng vào DB

const XLSX = require('xlsx');
const db = require('../../core/db');
const { buildSpecKey, legacyAttrs } = require('../../core/lib/specs');
const { vnToday } = require('../../core/lib/dates');

function parseNum(v) {
  if (v === '' || v == null) return 0;
  return parseFloat(String(v).replace(',', '.')) || 0;
}

function excelDateToISO(serial) {
  if (!serial) return null;
  if (typeof serial === 'number') {
    const d = XLSX.SSF.parse_date_code(serial);
    const y = d.y, m = String(d.m).padStart(2, '0'), day = String(d.d).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  if (typeof serial === 'string') {
    const s = serial.trim();
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    
    // DD/MM/YYYY or DD-MM-YYYY
    const parts = s.split(/[/\\-]/);
    if (parts.length === 3) {
      // Check if it's YYYY-MM-DD (already covered above, but just in case)
      if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      
      let [d, m, y] = parts;
      if (y.length === 2) y = '20' + y;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }
  return null;
}

function parseLengthStr(val) {
  if (!val) return '';
  val = val.trim().toLowerCase();
  if (val.includes('m')) {
    const num = parseFloat(val.replace('m', '.'));
    if (!isNaN(num)) return String(Math.round(num * 100));
  }
  return val;
}

function parseDimensions(str) {
  if (!str) return { length: '', width: '', thickness: '' };
  const parts = String(str).split('*').map(p => p.trim().toLowerCase().replace(/z$/, ''));
  if (parts.length === 2) {
    return { length: '', width: parseLengthStr(parts[0]), thickness: parts[1] };
  }
  return { 
    length: parseLengthStr(parts[0] || ''), 
    width: parseLengthStr(parts[1] || ''), 
    thickness: parts[2] || '' 
  };
}

async function findOrCreateCustomer(client, name) {
  const found = await client.query(
    `SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND is_deleted = FALSE LIMIT 1`,
    [name.trim()]
  );
  if (found.rows.length) return found.rows[0].id;
  const ins = await client.query(
    `INSERT INTO customers (name, status) VALUES ($1, 'Hoạt động') RETURNING id`,
    [name.trim()]
  );
  return ins.rows[0].id;
}

async function findOrCreateProduct(client, productName) {
  const code = productName === 'Bao Bì' ? 'SP00004' : 'SP00017';
  // Tìm theo mã KHÔNG lọc is_deleted — nếu đã xóa mềm thì khôi phục (tránh INSERT trùng mã → crash import)
  const found = await client.query(`SELECT id, is_deleted FROM products WHERE product_code = $1 LIMIT 1`, [code]);
  if (found.rows.length) {
    if (found.rows[0].is_deleted) await client.query(`UPDATE products SET is_deleted = FALSE WHERE id = $1`, [found.rows[0].id]);
    return found.rows[0].id;
  }
  const ins = await client.query(
    `INSERT INTO products (product_code, product_name, unit, status, product_type) VALUES ($1, $2, 'KG', 'Hoạt động', 'Thành phẩm') RETURNING id`,
    [code, productName]
  );
  return ins.rows[0].id;
}

// Thông số từ kích thước Excel — dùng khóa chuẩn 'Chiều ngang (Rộng)' (trước lưu khóa cũ 'Chiều ngang')
function specsFromDim(dim) {
  const specs = {};
  if (dim.length)    specs['Chiều dài']          = dim.length;
  if (dim.width)     specs['Chiều ngang (Rộng)'] = dim.width;
  if (dim.thickness) specs['Độ dày']             = dim.thickness;
  return specs;
}

// B3: đơn đã tồn tại (trùng Khách, Ngày, SL, thông số chuẩn hoá) — DÙNG CHUNG cho preview và confirm.
// customerId null (khách chưa có) → không thể trùng.
async function findDuplicateOrder(client, customerId, orderDate, qty, dim) {
  if (!customerId) return null;
  const r = await client.query(`
    SELECT so.id, so.order_code
    FROM sales_orders so
    JOIN sales_order_items soi ON soi.sales_order_id = so.id
    WHERE so.customer_id = $1 AND so.order_date = $2 AND so.is_deleted = FALSE
      AND soi.quantity = $3 AND soi.spec_key = $4
    LIMIT 1`, [customerId, orderDate, qty, buildSpecKey(specsFromDim(dim))]);
  return r.rows[0] || null;
}

async function findCustomerId(client, name) {
  const r = await client.query(`SELECT id FROM customers WHERE LOWER(name) = LOWER($1) AND is_deleted = FALSE LIMIT 1`, [String(name || '').trim()]);
  return r.rows[0]?.id || null;
}

async function importRow(client, row, idx, productId) {
  const [dateSerial, customerName, dimStr, kgPO, kgCuon, kgTui, phe, ghiChu, dueDateSerial] = row;

  const orderDate = excelDateToISO(dateSerial) || vnToday();
  const dueDate   = excelDateToISO(dueDateSerial) || null;
  const dim       = parseDimensions(dimStr);
  const qtyPO     = parseNum(kgPO);
  const qtyCuon   = parseNum(kgCuon);
  const qtyTui    = parseNum(kgTui);
  const qtyPhe    = parseNum(phe);
  const note      = ghiChu ? String(ghiChu).trim() : null;

  if (!customerName || !String(customerName).trim()) return { skipped: true, reason: 'Thiếu tên khách hàng' };
  if (qtyPO <= 0) return { skipped: true, reason: 'Số KG PO = 0' };

  // B3: chạy lại đúng câu kiểm trùng của preview — bấm xác nhận 2 lần không tạo đơn đôi
  const dup = await findDuplicateOrder(client, await findCustomerId(client, customerName), orderDate, qtyPO, dim);
  if (dup) return { skipped: true, row: idx, reason: `Đơn đã tồn tại (${dup.order_code}) — trùng Khách, Ngày, SL, Kích thước` };

  const customerId = await findOrCreateCustomer(client, String(customerName));

  const specs   = specsFromDim(dim);
  const specKey = buildSpecKey(specs);
  const legacy  = legacyAttrs(specs);

  const soRes = await client.query(
    `INSERT INTO sales_orders (customer_id, order_date, due_date, status, note)
     VALUES ($1, $2, $3, 'Hoàn thành', $4) RETURNING id`,
    [customerId, orderDate, dueDate, note]
  );
  const salesOrderId = soRes.rows[0].id;

  await client.query(
    `INSERT INTO sales_order_items
       (sales_order_id, product_id, quantity, unit, specs, spec_key, attr_size, attr_thickness, attr_color)
     VALUES ($1,$2,$3,'KG',$4::jsonb,$5,$6,$7,'')`,
    [salesOrderId, productId, qtyPO, JSON.stringify(specs), specKey, legacy.size, legacy.thickness]
  );

  const poRes = await client.query(
    `INSERT INTO production_orders
       (sales_order_id, customer_id, product_id, quantity, unit,
        attr_size, attr_thickness, attr_color, status, planned_date, due_date)
     VALUES ($1,$2,$3,$4,'KG',$5,$6,'','Hoàn thành',$7,$8) RETURNING id, order_code`,
    [salesOrderId, customerId, productId, qtyPO, legacy.size, legacy.thickness, orderDate, dueDate]
  );
  const { id: poId, order_code: poCode } = poRes.rows[0];

  // M02: đơn import là dữ liệu lịch sử, KHÔNG nhập kho → ghi posted_qty = SL thực ngay từ đầu.
  // Nếu để posted_qty = 0, lần "Lưu phân công" sau (bổ sung ca/đội) sẽ backflush nhập kho ảo toàn bộ SL.
  const cuonTaskQty = qtyCuon > 0 ? qtyCuon : qtyPO;
  await client.query(
    `INSERT INTO production_tasks
       (production_order_id, task_code, stage, quantity, actual_qty, scrap_qty, status, planned_date, seq, posted_qty)
     VALUES ($1,$2,'Thổi',$3,$3,0,'Hoàn thành',$4,1,$3)`,
    [poId, `${poCode}-1`, cuonTaskQty, orderDate]
  );

  const catTaskQty = qtyTui > 0 ? qtyTui : cuonTaskQty;
  await client.query(
    `INSERT INTO production_tasks
       (production_order_id, task_code, stage, quantity, actual_qty, scrap_qty, status, planned_date, seq, posted_qty)
     VALUES ($1,$2,'Cắt',$3,$3,$4,'Hoàn thành',$5,2,$3)`,
    [poId, `${poCode}-2`, catTaskQty, qtyPhe, orderDate]
  );
  await client.query(`UPDATE production_orders SET posted_qty = $2, inventory_posted = TRUE WHERE id = $1`, [poId, catTaskQty]);

  return {
    success: true,
    row: idx,
    customer: String(customerName).trim(),
    orderCode: poCode,
    kgPO: qtyPO,
  };
}

exports.previewOrders = async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) {
    return res.status(400).json({ message: 'Dữ liệu không hợp lệ' });
  }

  const client = await db.pool.connect();
  const previewData = [];

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const [dateSerial, customerName, dimStr, kgPO, kgCuon, kgTui, phe, ghiChu, dueDateSerial] = row;
      const sheetName = row.sheetName || '';
      
      const orderDate = excelDateToISO(dateSerial) || vnToday();
      const dueDate = excelDateToISO(dueDateSerial) || null;
      const dim       = parseDimensions(dimStr);
      const qtyPO     = parseNum(kgPO);
      const qtyCuon   = parseNum(kgCuon);
      const qtyTui    = parseNum(kgTui);
      const qtyPhe    = parseNum(phe);
      const note      = ghiChu ? String(ghiChu).trim() : null;
      const cName     = String(customerName || '').trim();

      const item = {
        _id: i + 1,
        sheetName,
        dateSerial,
        orderDate,
        dueDate,
        customerName: cName,
        dimStr: String(dimStr || '').trim(),
        dim,
        kgPO: qtyPO,
        kgCuon: qtyCuon,
        kgTui: qtyTui,
        phe: qtyPhe,
        ghiChu: note,
        isValid: true,
        errors: [],
        warnings: []
      };

      if (!cName) {
        item.isValid = false;
        item.errors.push('Thiếu tên khách hàng');
      }
      if (qtyPO <= 0) {
        item.isValid = false;
        item.errors.push('Số KG PO phải lớn hơn 0');
      }

      // Check duplicate in same batch
      const dupInBatch = previewData.some(d => 
        d.customerName.toLowerCase() === cName.toLowerCase() &&
        d.orderDate === orderDate &&
        d.kgPO === qtyPO &&
        d.dim.length === dim.length &&
        d.dim.width === dim.width &&
        d.dim.thickness === dim.thickness
      );

      if (dupInBatch) {
        item.isValid = false;
        item.errors.push('Dòng dữ liệu bị trùng lặp trong chính file Excel này');
      } else if (cName && qtyPO > 0) {
        const cId = await findCustomerId(client, cName);
        if (cId) {
          // Check trùng bằng spec_key CHUẨN HOÁ, so trên sales_order_items (dùng chung với confirm)
          if (await findDuplicateOrder(client, cId, orderDate, qtyPO, dim)) {
            item.isValid = false;
            item.errors.push('Đơn hàng có thể đã tồn tại (trùng Khách, Ngày, SL, Kích thước)');
          }
        } else {
          item.warnings.push('Khách hàng mới (sẽ được tạo tự động)');
        }
      }

      previewData.push(item);
    }

    res.json({ preview: previewData });
  } catch (e) {
    console.error('[previewOrders]', e);
    res.status(500).json({ message: 'Lỗi parse file: ' + e.message });
  } finally {
    client.release();
  }
};

exports.confirmOrders = async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'Dữ liệu không hợp lệ' });
  }

  const client = await db.pool.connect();
  const results = [];
  let successCount = 0, errorCount = 0;

  try {
    await client.query('BEGIN');
    // B3: 2 lần bấm xác nhận gửi đồng thời → lần sau chờ lần trước COMMIT rồi mới kiểm trùng (thấy đơn vừa tạo)
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('import_orders_confirm'))`);
    const baoBiId = await findOrCreateProduct(client, 'Bao Bì');
    const cuonPeId = await findOrCreateProduct(client, 'CUỘN PE');

    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      // B3: dòng preview đánh dấu không hợp lệ (thiếu dữ liệu / trùng) → bỏ qua, không tạo
      if (item && item.isValid === false) {
        results.push({ skipped: true, row: i + 1, reason: (item.errors || []).join('; ') || 'Dòng không hợp lệ' });
        continue;
      }
      // SAVEPOINT từng dòng: dòng lỗi chỉ rollback riêng nó, không làm hỏng cả transaction
      // (trước đây 1 dòng lỗi → transaction abort → COMMIT rỗng = 0 đơn, nhưng vẫn báo "N thành công").
      await client.query('SAVEPOINT sp_row');
      try {
        const rowArray = [
          item.dateSerial,
          item.customerName,
          item.dimStr,
          item.kgPO,
          item.kgCuon,
          item.kgTui,
          item.phe,
          item.ghiChu,
          item.dueDate
        ];
        const qtyTui = parseNum(item.kgTui);
        const productId = qtyTui > 0 ? baoBiId : cuonPeId;
        const result = await importRow(client, rowArray, i + 1, productId);
        await client.query('RELEASE SAVEPOINT sp_row');
        results.push(result);
        if (!result.skipped) successCount++;
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_row');
        errorCount++;
        results.push({ error: true, row: i + 1, message: e.message });
      }
    }

    await client.query('COMMIT');
    res.json({
      message: `Import hoàn tất: ${successCount} thành công, ${errorCount} lỗi`,
      summary: { success: successCount, errors: errorCount, total: rows.length },
      details: results,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[confirmOrders]', e);
    res.status(500).json({ message: 'Lỗi nghiêm trọng, đã rollback toàn bộ: ' + e.message });
  } finally {
    client.release();
  }
};
