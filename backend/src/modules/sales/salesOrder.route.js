const express = require('express');
const router = express.Router();
const { requirePerm, requireAnyPerm } = require('../../core/requireAuth');
const { hideCustomerContact } = require('../../core/lib/visibility');
const salesOrders = require('./salesOrderController');

const importCtrl = require('./importController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Xem đơn hàng: người có quyền xem Đơn hàng / Giao hàng / Khách hàng (màn Giao hàng & chi tiết khách cũng đọc đơn).
// Thông tin liên hệ khách trong đơn bị ẩn với người không có quyền liên hệ (core/lib/visibility.js).
const canReadOrders = [requireAnyPerm(['orders', 'view'], ['deliveries', 'view'], ['md_customers', 'view']), hideCustomerContact];

router.get('/customers/:id/orders', ...canReadOrders, salesOrders.byCustomer);
router.get('/customers/:id/deliverable-orders', ...canReadOrders, salesOrders.deliverableOrders);
router.get('/sales-orders', ...canReadOrders, salesOrders.list);
router.post('/sales-orders', requirePerm('orders:create'), salesOrders.create);
router.get('/sales-orders/:id', ...canReadOrders, salesOrders.getById);
router.put('/sales-orders/:id', requirePerm('orders:edit'), salesOrders.update);
router.delete('/sales-orders/:id', requirePerm('orders:delete'), salesOrders.remove);

// Upload Excel
router.post('/import/orders/preview', requirePerm('orders:create'), importCtrl.previewOrders);
router.post('/import/orders/confirm', requirePerm('orders:create'), importCtrl.confirmOrders);

module.exports = router;
