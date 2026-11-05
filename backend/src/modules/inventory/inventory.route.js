const express = require('express');
const router = express.Router();
const { requirePerm } = require('../../core/requireAuth');
const inventory = require('./inventoryController');

router.get('/inventory', inventory.list);
router.get('/inventory/tree', inventory.tree);
router.get('/inventory/detail', inventory.stockDetail);
router.get('/inventory/transactions', inventory.transactions);
router.post('/inventory/adjust', inventory.adjust);
router.post('/inventory/transfer', requirePerm('inv_transfer:create'), inventory.transfer);
router.post('/inventory/stock', requirePerm('inv_adjust:create'), inventory.addStockLine);
router.delete('/inventory/stock/:id', requirePerm('inv_adjust:create'), inventory.deleteStockLine);

// Phiếu xuất kho
router.post('/outbound-slips', requirePerm('inv_outbound:create'), inventory.createOutboundSlip);
router.post('/outbound-slips/reverse', inventory.reverseOutboundSlip); // Admin kiểm trong controller
router.get('/outbound-slips', inventory.listOutboundSlips);
router.get('/outbound-slips/:id', inventory.getOutboundSlip);
router.post('/outbound-slips/:id/confirm', requirePerm('inv_outbound:confirm'), inventory.confirmOutboundSlip);
router.post('/outbound-slips/:id/cancel', requirePerm('inv_outbound:confirm'), inventory.cancelOutboundSlip);

module.exports = router;
