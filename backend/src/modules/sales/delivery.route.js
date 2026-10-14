const express = require('express');
const router = express.Router();
const { requirePerm } = require('../../core/requireAuth');
const deliveries = require('./deliveryController');

router.get('/deliveries', deliveries.list);
router.post('/deliveries', requirePerm('deliveries:create'), deliveries.create);
router.get('/deliveries/from-order/:orderId', deliveries.fromOrder);
router.get('/deliveries/deliverable', deliveries.deliverable); // dòng đơn giao được của 1 khách (nhiều đơn/phiếu)
// Lịch sử thanh toán (quyền tiền kiểm trong controller: canEditAmounts)
router.post('/deliveries/payments/:pid/cancel', deliveries.cancelPayment);
router.post('/deliveries/:id/payments', deliveries.addPayment);
router.get('/deliveries/:id', deliveries.getById);
router.put('/deliveries/:id', requirePerm('deliveries:edit'), deliveries.update);
router.post('/deliveries/:id/ship', requirePerm('deliveries:approve'), deliveries.ship);
router.delete('/deliveries/:id', requirePerm('deliveries:delete'), deliveries.remove);

module.exports = router;
