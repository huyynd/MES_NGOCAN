const express = require('express');
const router = express.Router();
const receipts = require('./paymentReceiptController');
const { uuidParam } = require('../../core/lib/validate');
// :id không phải UUID → 404 trước khi chạm CSDL
router.param('id', uuidParam('Không tìm thấy phiếu thanh toán'));
router.param('customerId', uuidParam('Không tìm thấy khách hàng'));

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
