// backend/src/core/requestContext.js — ngữ cảnh của request đang chạy (ai đang thao tác).
// requireAuth gắn user vào đây; các hàm lõi (vd applyStock ghi sổ cái) đọc ra mà không phải truyền tham số
// qua mọi tầng controller. Ngoài request (script, migrate) → null.
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

const runWithUser = (user, fn) => als.run({ user }, fn);
const currentUser = () => als.getStore()?.user || null;

module.exports = { runWithUser, currentUser };
