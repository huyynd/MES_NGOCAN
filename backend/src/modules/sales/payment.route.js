const express = require('express');
const router = express.Router();
const receipts = require('./paymentReceiptController');

// Phiếu thanh toán + Báo cáo công nợ — quyền tiền (xem / ghi) kiểm trong controller (money.js)
router.get('/payment-receipts', receipts.list);
router.post('/payment-receipts', receipts.create);
router.get('/payment-receipts/customer/:customerId', receipts.customerSummary);
router.get('/payment-receipts/:id', receipts.getById);
router.put('/payment-receipts/:id', receipts.update);
router.post('/payment-receipts/:id/cancel', receipts.cancel);
router.get('/receivables', receipts.receivables);
router.get('/receivables/:customerId', receipts.receivableDetail);
router.put('/receivables/:customerId/opening', receipts.saveOpening);
router.delete('/receivables/:customerId/opening', receipts.deleteOpening);

module.exports = router;
