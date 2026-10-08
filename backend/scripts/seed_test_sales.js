const db = require('../src/core/db');

async function seed() {
  try {
    console.log('Seeding test data...');

    // Get a customer
    const resCust = await db.query(`SELECT id FROM customers LIMIT 1`);
    if (resCust.rows.length === 0) {
      console.log('No customers found, please create one first.');
      process.exit(1);
    }
    const customerId = resCust.rows[0].id;

    // Get a product
    const resProd = await db.query(`SELECT id FROM products WHERE product_type = 'Thành phẩm' LIMIT 1`);
    if (resProd.rows.length === 0) {
      console.log('No products found, please create one first.');
      process.exit(1);
    }
    const productId = resProd.rows[0].id;

    // Create a new sales order in current month
    const today = new Date();
    const orderDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const orderCode = 'SO-TEST-' + Date.now();

    const soRes = await db.query(
      `INSERT INTO sales_orders (order_code, customer_id, order_date, status)
       VALUES ($1, $2, $3, 'Mới') RETURNING id`,
      [orderCode, customerId, orderDate]
    );
    const soId = soRes.rows[0].id;
    console.log(`Created Sales Order: ${orderCode} (ID: ${soId})`);

    // Create a sales order item (100 units * 300,000 = 30,000,000)
    const soiRes = await db.query(
      `INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [soId, productId, 100, 300000]
    );
    const soiId = soiRes.rows[0].id;

    // Create a delivery note for this order
    const dnCode = 'DN-TEST-' + Date.now();
    const dnRes = await db.query(
      `INSERT INTO delivery_notes (note_code, customer_id, delivery_date, status, total_amount, paid_amount)
       VALUES ($1, $2, $3, 'Đã xuất hóa đơn', $4, $5) RETURNING id`,
      [dnCode, customerId, orderDate, 30000000, 10000000]
    );
    const dnId = dnRes.rows[0].id;
    console.log(`Created Delivery Note: ${dnCode} (ID: ${dnId})`);

    // Create a delivery note item
    await db.query(
      `INSERT INTO delivery_note_items (delivery_note_id, product_id, quantity, sales_order_item_id)
       VALUES ($1, $2, $3, $4)`,
      [dnId, productId, 50, soiId] // Delivered 50/100 -> Half delivered (15,000,000)
    );

    console.log('Seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seed();
