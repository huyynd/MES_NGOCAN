// backend/routes/products.js
const express = require('express');
const router = express.Router();
const { requirePerm } = require('../../core/requireAuth');
const ctrl = require('./productController');
const { uuidParam } = require('../../core/lib/validate');
// :id không phải UUID → 404 trước khi chạm CSDL
router.param('id', uuidParam('Không tìm thấy sản phẩm'));
router.param('attId', uuidParam('Không tìm thấy tài liệu'));

router.get('/', ctrl.getProducts);
router.post('/', requirePerm('products:create'), ctrl.createProduct);
router.post('/import', requirePerm('products:create'), ctrl.bulkImport);
router.get('/:id/related', ctrl.related);
router.get('/:id/attachments', ctrl.listAttachments);
router.post('/:id/attachments', requirePerm('products:edit'), ctrl.addAttachment);
router.get('/:id/attachments/:attId/file', ctrl.getAttachmentFile);
router.delete('/:id/attachments/:attId', requirePerm('products:edit'), ctrl.deleteAttachment);
router.get('/:id', ctrl.getProductById);
router.put('/:id', requirePerm('products:edit'), ctrl.updateProduct);
router.delete('/:id', requirePerm('products:delete'), ctrl.softDeleteProduct);

module.exports = router;
