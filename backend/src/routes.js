const express = require('express');
const router = express.Router();
const requireAuth = require('./core/requireAuth');

// ---- Public Routes ----
router.use('/auth', require('./modules/auth/auth.route'));

// ========================================================
// Toàn bộ route bên dưới yêu cầu xác thực hợp lệ
// ========================================================
router.use(requireAuth);

router.use('/', require('./modules/masterData/masterData.route'));
router.use('/', require('./modules/auth/role.route'));
router.use('/', require('./modules/auth/user.route'));
router.use('/', require('./modules/production/workSchedule.route'));
router.use('/', require('./modules/sales/salesOrder.route'));
router.use('/', require('./modules/sales/delivery.route'));
router.use('/', require('./modules/sales/payment.route'));
router.use('/', require('./modules/production/production.route'));
router.use('/', require('./modules/engineering/process.route'));
router.use('/', require('./modules/engineering/bom.route'));
router.use('/', require('./modules/production/planning.route'));
router.use('/', require('./modules/inventory/inventory.route'));
router.use('/', require('./modules/production/dashboard.route'));
router.use('/', require('./modules/production/report.route'));
router.use('/', require('./modules/recycling/recycling.route'));
router.use('/', require('./modules/masterData/lookup.route'));

module.exports = router;

