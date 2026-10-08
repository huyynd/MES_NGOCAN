const db = require('../src/core/db');

async function check() {
  try {
    const res = await db.query(`
      SELECT pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'delivery_notes_status_check'
    `);
    console.log(res.rows[0].def);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
check();
