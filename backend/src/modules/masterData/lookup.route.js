const express = require('express');
const router = express.Router();
const { requirePerm } = require('../../core/requireAuth');
const lookups = require('./lookupController');
const settings = require('./settingsController');

// Cài đặt hệ thống: CHỈ Admin (đọc đầy đủ + ghi). Giá trị dùng chung cho các màn đã có trong /lookups (settings).
const adminOnly = (req, res, next) => (req.user?.is_admin ? next() : res.status(403).json({ message: 'Chỉ Admin được sửa cài đặt hệ thống' }));

router.get('/lookups', lookups.all);
router.get('/next-code/:entity', lookups.nextCode);
router.get('/app-settings', adminOnly, settings.list);
router.put('/app-settings', adminOnly, settings.save);

module.exports = router;
