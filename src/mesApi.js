// src/mesApi.js — client gọi backend cho các phân hệ mở rộng
const API_BASE = import.meta.env?.VITE_API_BASE || "https://mes-ngocan.onrender.com";

let authToken = (typeof localStorage !== "undefined" && localStorage.getItem("mes_token")) || "";
export function setToken(t) {
  authToken = t || "";
  if (typeof localStorage !== "undefined") { if (t) localStorage.setItem("mes_token", t); else localStorage.removeItem("mes_token"); }
}
export function getToken() { return authToken; }

async function http(path, opts = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.message) msg = j.message; } catch { /* ignore */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.status === 204 ? null : res.json();
}

const body = (m, b) => ({ method: m, body: JSON.stringify(b) });

// CRUD chung cho master-data
export function resource(name) {
  return {
    list: (params = {}) => {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
      return http(`/${name}?${q.toString()}`).then((r) => r.data ?? r);
    },
    get: (id) => http(`/${name}/${id}`),
    create: (data) => http(`/${name}`, body("POST", data)),
    update: (id, data) => http(`/${name}/${id}`, body("PUT", data)),
    remove: (id) => http(`/${name}/${id}`, { method: "DELETE" }),
    importRows: (rows) => http(`/${name}/import`, body("POST", { rows })),
  };
}

export const getLookups = () => http(`/lookups`);
export const getDashboard = () => http(`/dashboard`);
export const customerOrders = (id) => http(`/customers/${id}/orders`).then((r) => r.data);
export const deliverableOrders = (id) => http(`/customers/${id}/deliverable-orders`).then((r) => r.data);
export const nextCode = (entity) => http(`/next-code/${entity}`).then((r) => r.code);
export const productRelated = (id) => http(`/products/${id}/related`);
export const productFiles = {
  list: (id) => http(`/products/${id}/attachments`),
  add: (id, payload) => http(`/products/${id}/attachments`, body("POST", payload)),
  file: (id, attId) => http(`/products/${id}/attachments/${attId}/file`),
  remove: (id, attId) => http(`/products/${id}/attachments/${attId}`, { method: "DELETE" }),
};
export const machineOrders = (id) => http(`/machines/${id}/orders`).then((r) => r.data);

export const workSchedules = {
  list: (from, to) => http(`/work-schedules?from=${from}&to=${to}`).then((r) => r.data),
  upsert: (data) => http(`/work-schedules`, body("PUT", data)),
  bulkUpsert: (data) => http(`/work-schedules/bulk`, body("PUT", data)),
};

export const roles = {
  ...resource("roles"),
  savePermissions: (id, permissions, parent_id) => http(`/roles/${id}/permissions`, body("PUT", { permissions, parent_id })),
  getEffectivePermissions: (id) => http(`/roles/${id}/effective-permissions`),
};

export const deliveries = {
  ...resource("deliveries"),
  fromOrder: (orderId) => http(`/deliveries/from-order/${orderId}`),
  ship: (id) => http(`/deliveries/${id}/ship`, body("POST", {})),
};

export const processes = resource("processes");
export const users = resource("users");
export const auth = {
  login: (data) => http(`/auth/login`, body("POST", data)),
  me: () => http(`/auth/me`),
  logout: () => http(`/auth/logout`, { method: "POST" }),
};

export const production = {
  ...resource("production-orders"),
  schedule: (id, data) => http(`/production-orders/${id}/schedule`, body("PUT", data)),
  reschedule: (id, date) => http(`/production-orders/${id}/reschedule`, body("PUT", { date })),
  getTasks: (id) => http(`/production-orders/${id}/tasks`).then((r) => r.data),
  saveTasks: (id, tasks) => http(`/production-orders/${id}/tasks`, body("PUT", { tasks })),
  gantt: (from, to) => http(`/production/gantt?from=${from}&to=${to}`).then((r) => r.data),
  machineAvailability: () => http(`/production/machine-availability`).then((r) => r.data),
  execution: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return http(`/production/execution?${q.toString()}`).then((r) => r.data);
  },
  taskByCode: (code) => http(`/production/task-by-code/${encodeURIComponent(code)}`),
  updateTask: (taskId, data) => http(`/production/tasks/${taskId}`, body("PUT", data)),
  materials: (id) => http(`/production-orders/${id}/materials`),
  saveMaterials: (id, lines) => http(`/production-orders/${id}/materials`, body("POST", { lines })),
  // NVL cần cung cấp (kế hoạch) + Yêu cầu NVL (xuất kho)
  plannedMaterials: (id) => http(`/production-orders/${id}/planned-materials`).then((r) => r.data),
  savePlannedMaterials: (id, lines) => http(`/production-orders/${id}/planned-materials`, body("POST", { lines })),
  requestMaterials: (id, lines) => http(`/production-orders/${id}/request-materials`, body("POST", { lines })),
};

export const planning = {
  fromOrders: () => http(`/planning/from-orders`),
  generate: (data) => http(`/planning/generate`, body("POST", data)),
  groups: (statuses) => http(`/planning/groups${statuses ? "?status=" + encodeURIComponent(statuses) : ""}`),
  materialRequirements: () => http(`/planning/material-requirements`),
};

export const inventory = {
  list: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return http(`/inventory?${q.toString()}`).then((r) => r.data || []);
  },
  tree: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return http(`/inventory/tree?${q.toString()}`).then((r) => r.data || []);
  },
  adjust: (data) => http(`/inventory/adjust`, body("POST", data)),
  transactions: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return http(`/inventory/transactions?${q.toString()}`).then((r) => r.data || []);
  },
  detail: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return http(`/inventory/detail?${q.toString()}`);
  },
  addStock: (data) => http(`/inventory/stock`, body("POST", data)),
  deleteStock: (id) => http(`/inventory/stock/${id}`, { method: "DELETE" }),
  transfer: (data) => http(`/inventory/transfer`, body("POST", data)),
  // Phiếu xuất kho (Chờ xuất → Đã xuất)
  outboundSlips: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return http(`/outbound-slips?${q.toString()}`).then((r) => r.data || []);
  },
  createOutboundSlip: (data) => http(`/outbound-slips`, body("POST", data)),
  outboundSlip: (id) => http(`/outbound-slips/${id}`).then((r) => r.data),
  confirmOutboundSlip: (id) => http(`/outbound-slips/${id}/confirm`, body("POST", {})),
  cancelOutboundSlip: (id) => http(`/outbound-slips/${id}/cancel`, body("POST", {})),
};

export const reports = {
  kpi: () => http(`/reports/kpi`),
  detailed: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== 'Tất cả'));
    return http(`/reports/detailed?${q.toString()}`).then(r => r);
  },
  machines: () => http(`/reports/machines`),
  employees: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    return http(`/reports/employees?${q.toString()}`).then(r => r.data || []);
  },
  employeeTasks: (worker, params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    return http(`/reports/employees/${encodeURIComponent(worker)}/tasks?${q.toString()}`);
  },
  director: (period = 'month') => http(`/reports/director?period=${period}`),
};

export const salesOrders = {
  ...resource("sales-orders"),
  previewExcel: (rows) => http(`/import/orders/preview`, body("POST", { rows })),
  confirmExcel: (rows) => http(`/import/orders/confirm`, body("POST", { rows })),
};

export const scrap = {
  workers: () => http(`/scrap/workers`).then(r => r),

  dailyWos: (worker_name, date) => http(`/scrap/daily-wos?worker_name=${encodeURIComponent(worker_name)}&date=${date}`).then(r => r),
  records: (worker_name, date) => http(`/scrap/records?worker_name=${encodeURIComponent(worker_name)}&date=${date}`).then(r => r),
  allRecords: (date) => http(`/scrap/all-records?date=${date}`).then(r => r),
  save: (data) => http(`/scrap/records`, body("POST", data)),
  stats: (worker_name, end_date) => http(`/scrap/statistics?worker_name=${encodeURIComponent(worker_name)}&end_date=${end_date}`).then(r => r),
  dailyDetails: (worker_name, date) => http(`/scrap/daily-details?worker_name=${encodeURIComponent(worker_name)}&date=${date}`).then(r => r),
};

export const recycling = {
  ...resource("recycling"),
  weigh: (id, data) => http(`/recycling/${id}/weigh`, body("PUT", data)),
  receiveRolls: (id, rolls) => http(`/recycling/${id}/receive`, body("PUT", { rolls })),
  complete: (id, data) => http(`/recycling/${id}/complete`, body("PUT", data)),
};
