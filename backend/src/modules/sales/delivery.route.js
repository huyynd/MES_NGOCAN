const express = require('express');
const router = express.Router();
const { requirePerm } = require('../../core/requireAuth');
const deliveries = require('./deliveryController');

router.get('/deliveries', deliveries.list);
router.post('/deliveries', requirePerm('deliveries:create'), deliveries.create);
router.get('/deliveries/from-order/:orderId', deliveries.fromOrder);
router.get('/deliveries/deliverable', deliveries.deliverable); // dòng đơn giao được của 1 khách (nhiều đơn/phiếu)
// Thanh toán: ghi nhận qua Phiếu thanh toán (payment.route.js) — không thu lẻ trên từng phiếu giao nữa
router.get('/deliveries/:id', deliveries.getById);
router.put('/deliveries/:id', requirePerm('deliveries:edit'), deliveries.update);
router.post('/deliveries/:id/ship', requirePerm('deliveries:approve'), deliveries.ship);
// K-12: khách trả hàng — nhập lại kho đúng lô / thông số đã giao
router.get('/deliveries/:id/returns', deliveries.returnable);
router.post('/deliveries/:id/returns', requirePerm('deliveries:approve'), deliveries.createReturn);
router.delete('/deliveries/:id', requirePerm('deliveries:delete'), deliveries.remove);

module.exports = router;
