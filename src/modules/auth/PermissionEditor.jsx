import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ShieldCheck, Search, Edit, Trash2, X, ChevronRight, ChevronDown,
  Package, Factory, LayoutDashboard, Calendar, Check, RotateCcw,
  BarChart2, Settings, Save, ArrowLeft, Recycle
} from "lucide-react";
import { ListHeader } from "../../components.jsx";
import { roles } from "../../mesApi.js";
import { toast } from "../../ui.js";

/* ═══════════════════════════════════════════════════════════════
   1. CẤU TRÚC DỮ LIỆU – CONSTANTS
═══════════════════════════════════════════════════════════════ */

export const ACTION_LABELS = {
  view: "Xem", create: "Tạo mới", edit: "Sửa", delete: "Xóa",
  approve: "Duyệt", publish: "Phát hành", assign: "Phân công",
  execute: "Thực thi", import: "Import", export: "Xuất Excel",
  print: "In tem", view_amounts: "Xem Kế toán/Tiền",
  request: "Yêu cầu", confirm: "Xác nhận"
};

// HTTP method tương ứng với từng action
const ACTION_HTTP = {
  view: "GET", create: "POST", edit: "PUT", delete: "DELETE",
  approve: "PUT", publish: "PUT", assign: "PUT",
  execute: "POST", import: "POST", export: "GET", print: "GET",
  request: "POST", confirm: "POST"
};

// Route API tương ứng với từng module
const MODULE_ROUTES = {
  dashboard:    "/api/dashboard",
  orders:       "/api/orders",
  deliveries:   "/api/deliveries",
  planning:     "/api/planning",
  workschedule: "/api/work-schedules",
  production:   "/api/production-orders",
  orderstatus:  "/api/production-orders",
  execution:    "/api/production/execution",
  scrap:        "/api/scrap",
  recycling:    "/api/recycling",
  prod_output:  "/api/production/output",
  qrlabels:     "/api/qr-labels",
  inventory:    "/api/inventory",
  inv_inbound:  "/api/inventory/inbound",
  inv_outbound: "/api/inventory/outbound",
  inv_transfer: "/api/inventory/transfer",
  inv_adjust:   "/api/inventory/adjust",
  qrscan:       "/api/qr/scan",
  trace_lot:    "/api/trace/lot",
  reports:      "/api/reports/kpi",
  rep_inv:      "/api/reports/inventory",
  rep_employee: "/api/reports/employees",
  products:     "/api/products",
  bom:          "/api/bom",
  process:      "/api/processes",
  md_machines:  "/api/machines",
  md_employees: "/api/employees",
  md_shifts:    "/api/shifts",
  md_warehouses:"/api/warehouses",
  md_zones:     "/api/zones",
  md_locations: "/api/locations",
  md_customers: "/api/customers",
  md_roles:     "/api/roles",
  // Quản trị hệ thống
  sys_users:       "/api/users",
  sys_permissions: "/api/roles",
  sys_config:      "/api/system/config",
  sys_logs:        "/api/system/logs",
};

export const PERM_TREE = [
  {
    category: "Hệ thống chung",
    icon: LayoutDashboard,
    modules: [
      { key: "dashboard", label: "Dashboard", actions: ["view"] }
    ]
  },
  {
    category: "Kinh doanh & Kế hoạch",
    icon: Calendar,
    modules: [
      { key: "orders",       label: "Đơn hàng",            actions: ["view","create","edit","delete","approve","view_amounts"] },
      { key: "deliveries",   label: "Phiếu giao hàng",      actions: ["view","create","edit","delete","approve", "view_amounts"] },
      { key: "planning",     label: "Kế hoạch sản xuất",    actions: ["view","create","edit","publish"] },
      { key: "workschedule", label: "Lịch sản xuất",        actions: ["view","create","edit","publish"] },
    ]
  },
  {
    category: "Sản xuất",
    icon: Factory,
    modules: [
      { key: "production",  label: "Lệnh sản xuất",        actions: ["view","create","edit","delete","publish","assign","export","request"] },
      { key: "orderstatus", label: "Lệnh theo trạng thái", actions: ["view","edit"] },
      { key: "execution",   label: "Thực thi sản xuất",    actions: ["view","execute"] },
      { key: "prod_output", label: "Sản lượng",            actions: ["view","edit","export"] },
      { key: "qrlabels",   label: "In tem xuất xứ",        actions: ["view","create","print"] },
    ]
  },
  {
    category: "Phế phẩm & Tái chế",
    icon: Recycle,
    modules: [
      { key: "scrap",       label: "Ghi nhận phế phẩm",    actions: ["view","create","edit","delete"] },
      { key: "recycling",   label: "Quản lý tái chế",      actions: ["view","create","edit","approve"] },
    ]
  },
  {
    category: "Kho",
    icon: Package,
    modules: [
      { key: "inventory",    label: "Tồn kho",            actions: ["view","export"] },
      { key: "inv_inbound",  label: "Nhập kho",           actions: ["view","create","edit","delete","approve"] },
      { key: "inv_outbound", label: "Xuất kho",           actions: ["view","create","edit","delete","approve","confirm"] },
      { key: "inv_transfer", label: "Chuyển kho",         actions: ["view","create","approve"] },
      { key: "inv_adjust",   label: "Điều chỉnh tồn kho", actions: ["view","create","approve"] },
    ]
  },
  {
    category: "Truy xuất",
    icon: Search,
    modules: [
      { key: "qrscan",    label: "Tra cứu xuất xứ", actions: ["view"] },
      { key: "trace_lot", label: "Truy xuất lô",    actions: ["view"] },
    ]
  },
  {
    category: "Báo cáo",
    icon: BarChart2,
    modules: [
      { key: "rep_director",  label: "Báo cáo giám đốc",     actions: ["view","export"] },
      { key: "reports",       label: "Báo cáo KPI",          actions: ["view","export"] },
      { key: "rep_inv",       label: "Báo cáo kho",          actions: ["view","export"] },
      { key: "rep_employee",  label: "Hiệu suất nhân viên",  actions: ["view","export"] },
    ]
  },
  {
    category: "Quản trị hệ thống",
    icon: ShieldCheck,
    modules: [
      { key: "sys_users",       label: "Tài khoản người dùng", actions: ["view", "create", "edit", "delete"] },
      { key: "md_roles",        label: "Vai trò",              actions: ["view", "create", "edit", "delete"] },
      { key: "sys_permissions", label: "Phân quyền hệ thống",  actions: ["view", "edit"] },
      { key: "sys_config",      label: "Cấu hình hệ thống",    actions: ["view", "edit"] },
      { key: "sys_logs",        label: "Nhật ký hoạt động",    actions: ["view", "export"] },
    ]
  },
  {
    category: "Quản trị danh mục",
    icon: Settings,
    modules: [
      { key: "products",      label: "Sản phẩm",          actions: ["view","create","edit","delete"] },
      { key: "bom",           label: "Định mức (BOM)",     actions: ["view","create","edit","delete"] },
      { key: "process",       label: "Quy trình công nghệ",actions: ["view","create","edit","delete"] },
      { key: "md_machines",   label: "Máy móc",            actions: ["view","create","edit"] },
      { key: "md_employees",  label: "Nhân viên",          actions: ["view","create","edit"] },
      { key: "md_shifts",     label: "Ca làm việc",        actions: ["view","create","edit","delete"] },
      { key: "md_warehouses", label: "Kho (danh mục)",     actions: ["view","create","edit","delete"] },
      { key: "md_zones",      label: "Khu vực",            actions: ["view","create","edit","delete"] },
      { key: "md_locations",  label: "Vị trí lưu trữ",     actions: ["view","create","edit","delete"] },
      { key: "md_customers",  label: "Khách hàng",         actions: ["view","create","edit","delete"] },
    ]
  }
];

/* ─── Helpers ─── */

/** Tìm thông tin module từ key */
export const getModuleInfo = (key) => {
  for (const cat of PERM_TREE) {
    const mod = cat.modules.find(m => m.key === key);
    if (mod) return { category: cat.category, ...mod };
  }
  return { category: "Khác", key, label: key, actions: ["view"] };
};

/** Tạo mã quyền dot-notation: "bom.create" */
export const getPermCode = (modKey, actKey) => `${modKey}.${actKey}`;

/** Tạo thông tin API: { method, path } */
export const getApiInfo = (modKey, actKey) => ({
  method: ACTION_HTTP[actKey] || "GET",
  path:   MODULE_ROUTES[modKey] || `/api/${modKey}`,
});

/* ═══════════════════════════════════════════════════════════════
   2. INDETERMINATE CHECKBOX COMPONENT
═══════════════════════════════════════════════════════════════ */

function IndeterminateCheckbox({ checked, indeterminate, onChange, id, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={!!checked}
      onChange={onChange}
      className={`w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600 flex-shrink-0 ${className}`}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════
   3. TRẠNG THÁI CHECKBOX – HELPERS
═══════════════════════════════════════════════════════════════ */

function isActionAllow(draft, modKey, actKey) {
  const v = (draft[modKey] || {})[actKey];
  return v?.status === "ALLOW" || v === true;
}

function getModuleState(draft, modKey) {
  const modInfo = getModuleInfo(modKey);
  const active = modInfo.actions.filter(a => isActionAllow(draft, modKey, a)).length;
  if (active === 0) return "NONE";
  if (active === modInfo.actions.length) return "ALL";
  return "PARTIAL";
}

function getCategoryState(draft, cat) {
  let total = 0, active = 0;
  cat.modules.forEach(mod => {
    mod.actions.forEach(a => {
      total++;
      if (isActionAllow(draft, mod.key, a)) active++;
    });
  });
  if (active === 0) return "NONE";
  if (active === total) return "ALL";
  return "PARTIAL";
}

/* ═══════════════════════════════════════════════════════════════
   4. PERM TREE EDITOR – Core UI (tái sử dụng trong Drawer & PermissionEditor)
═══════════════════════════════════════════════════════════════ */

const HTTP_BADGE = {
  GET:    "bg-sky-50 text-sky-700 border-sky-200",
  POST:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  PUT:    "bg-amber-50 text-amber-700 border-amber-200",
  DELETE: "bg-rose-50 text-rose-700 border-rose-200",
};

const SCOPE_OPTIONS = [
  { code: "ALL",     label: "Toàn bộ" },
  { code: "FACTORY", label: "Nhà máy" },
  { code: "WAREHOUSE", label: "Kho" },
  { code: "CUSTOM",  label: "Tùy chỉnh" },
];

function PermTreeEditor({ draft, setDraft, searchQuery = "", inheritedPerms = {} }) {
  const [expandedCats, setExpandedCats] = useState(
    () => Object.fromEntries(PERM_TREE.map(c => [c.category, true]))
  );
  const [expandedMods, setExpandedMods] = useState({});

  /* ── Toggle handlers (5 cases) ── */
  const handleToggleCat = (cat) => {
    const state = getCategoryState(draft, cat);
    const newDraft = { ...draft };
    if (state === "ALL" || state === "PARTIAL") {
      cat.modules.forEach(mod => { delete newDraft[mod.key]; });
    } else {
      cat.modules.forEach(mod => {
        newDraft[mod.key] = {};
        mod.actions.forEach(a => { newDraft[mod.key][a] = { status: "ALLOW", scope: "ALL", scopeValue: "" }; });
      });
    }
    setDraft(newDraft);
  };

  const handleToggleMod = (mod) => {
    const state = getModuleState(draft, mod.key);
    const newDraft = { ...draft };
    if (state === "ALL" || state === "PARTIAL") {
      delete newDraft[mod.key];
    } else {
      newDraft[mod.key] = {};
      mod.actions.forEach(a => { newDraft[mod.key][a] = { status: "ALLOW", scope: "ALL", scopeValue: "" }; });
    }
    setDraft(newDraft);
  };

  const handleToggleAction = (modKey, actKey) => {
    const modDraft = { ...(draft[modKey] || {}) };
    if (isActionAllow(draft, modKey, actKey)) {
      delete modDraft[actKey];
    } else {
      modDraft[actKey] = { status: "ALLOW", scope: "ALL", scopeValue: "" };
    }
    const newDraft = { ...draft };
    if (Object.keys(modDraft).length === 0) delete newDraft[modKey];
    else newDraft[modKey] = modDraft;
    setDraft(newDraft);
  };

  const handleChangeScope = (modKey, actKey, field, val) => {
    const actDraft = (draft[modKey] || {})[actKey] || { status: "ALLOW", scope: "ALL", scopeValue: "" };
    setDraft({ ...draft, [modKey]: { ...draft[modKey], [actKey]: { ...actDraft, [field]: val } } });
  };

  const q = searchQuery.toLowerCase();

  return (
    <div className="space-y-2">
      {PERM_TREE.map(cat => {
        const filteredMods = cat.modules.filter(mod => {
          if (!q) return true;
          if (cat.category.toLowerCase().includes(q)) return true;
          if (mod.label.toLowerCase().includes(q) || mod.key.includes(q)) return true;
          return mod.actions.some(a =>
            (ACTION_LABELS[a] || a).toLowerCase().includes(q) ||
            getPermCode(mod.key, a).includes(q)
          );
        });
        if (filteredMods.length === 0) return null;

        const catState    = getCategoryState(draft, cat);
        const isCatExpand = !!expandedCats[cat.category];

        return (
          <div key={cat.category} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {/* ── Category Row ── */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-100/70 hover:bg-slate-100 transition-colors">
              <IndeterminateCheckbox
                checked={catState === "ALL"}
                indeterminate={catState === "PARTIAL"}
                onChange={() => handleToggleCat(cat)}
              />
              <button
                className="flex-1 flex items-center gap-2 text-left min-w-0"
                onClick={() => setExpandedCats(p => ({ ...p, [cat.category]: !p[cat.category] }))}
              >
                <cat.icon size={14} className="text-slate-500 flex-shrink-0" />
                <span className="font-bold text-slate-700 text-sm uppercase tracking-wide truncate">
                  {cat.category}
                </span>
                <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
                  {filteredMods.length} chức năng
                </span>
                {isCatExpand
                  ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
                  : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
              </button>
            </div>

            {/* ── Modules ── */}
            {isCatExpand && (
              <div className="divide-y divide-slate-100 bg-white">
                {filteredMods.map(mod => {
                  const modState    = getModuleState(draft, mod.key);
                  const isModExpand = !!expandedMods[mod.key];
                  const selectedCnt = mod.actions.filter(a => isActionAllow(draft, mod.key, a)).length;

                  return (
                    <div key={mod.key}>
                      {/* Module Row */}
                      <div className="flex items-center gap-2 pl-8 pr-3 py-2 hover:bg-indigo-50/30 transition-colors">
                        <IndeterminateCheckbox
                          checked={modState === "ALL"}
                          indeterminate={modState === "PARTIAL"}
                          onChange={() => handleToggleMod(mod)}
                        />
                        <button
                          className="flex-1 flex items-center gap-2 text-left min-w-0"
                          onClick={() => setExpandedMods(p => ({ ...p, [mod.key]: !p[mod.key] }))}
                        >
                          <span className="text-sm font-semibold text-slate-700 truncate">{mod.label}</span>
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 ${
                            modState === "ALL"     ? "bg-indigo-50 text-indigo-600 border-indigo-200" :
                            modState === "PARTIAL" ? "bg-amber-50 text-amber-600 border-amber-200" :
                                                     "bg-slate-50 text-slate-400 border-slate-200"
                          }`}>
                            {selectedCnt}/{mod.actions.length}
                          </span>
                          <span className="ml-auto flex-shrink-0">
                            {isModExpand
                              ? <ChevronDown size={13} className="text-slate-400" />
                              : <ChevronRight size={13} className="text-slate-400" />}
                          </span>
                        </button>
                      </div>

                      {/* ── Actions ── */}
                      {isModExpand && (
                        <div className="pl-14 pr-3 pb-2 pt-1 bg-slate-50/60 space-y-1.5">
                          {mod.actions
                            .filter(a => !q || (ACTION_LABELS[a] || a).toLowerCase().includes(q) || getPermCode(mod.key, a).includes(q) || mod.label.toLowerCase().includes(q))
                            .map(actKey => {
                              const isChecked   = isActionAllow(draft, mod.key, actKey);
                              const actVal      = (draft[mod.key] || {})[actKey];
                              const isInherited = !isChecked &&
                                (inheritedPerms[mod.key]?.[actKey]?.status === "ALLOW" || inheritedPerms[mod.key]?.[actKey] === true);
                              const permCode    = getPermCode(mod.key, actKey);
                              const { method, path } = getApiInfo(mod.key, actKey);

                              return (
                                <div key={actKey} className={`rounded-lg border transition-all ${
                                  isChecked    ? "bg-white border-indigo-200 shadow-sm" :
                                  isInherited  ? "bg-blue-50/60 border-blue-200" :
                                                 "bg-white border-slate-100"
                                }`}>
                                  <label className="flex items-start gap-2.5 px-3 py-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleToggleAction(mod.key, actKey)}
                                      className="w-4 h-4 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600 flex-shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                      {/* Action label + badges */}
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`text-sm font-semibold ${
                                          isChecked   ? "text-indigo-700" :
                                          isInherited ? "text-blue-600"   : "text-slate-500"
                                        }`}>
                                          {ACTION_LABELS[actKey] || actKey}
                                        </span>
                                        {isInherited && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-medium border border-blue-200">
                                            🔵 Kế thừa
                                          </span>
                                        )}
                                        {isChecked && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium border border-emerald-200">
                                            🟢 Trực tiếp
                                          </span>
                                        )}
                                      </div>
                                      {/* API path badges */}
                                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                        <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${HTTP_BADGE[method] || "bg-slate-50 text-slate-500 border-slate-200"}`}>
                                          {method}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                                          {path}
                                        </span>
                                        <span className="text-[10px] font-mono text-purple-500 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">
                                          {permCode}
                                        </span>
                                      </div>
                                    </div>
                                  </label>

                                  {/* Scope selector (khi đã checked) */}
                                  {isChecked && (
                                    <div className="px-3 pb-2.5 pt-0">
                                      <div className="flex flex-wrap gap-1.5">
                                        {SCOPE_OPTIONS.map(s => {
                                          const sel = (actVal?.scope || "ALL") === s.code;
                                          return (
                                            <label key={s.code} className={`flex items-center gap-1 px-2 py-1 rounded border cursor-pointer text-[10px] transition-all ${
                                              sel ? "bg-indigo-50 border-indigo-400 text-indigo-700 font-semibold" :
                                                    "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                                            }`}>
                                              <input type="radio" name={`scope_${mod.key}_${actKey}`} className="hidden"
                                                checked={sel} onChange={() => handleChangeScope(mod.key, actKey, "scope", s.code)} />
                                              <div className={`w-2.5 h-2.5 rounded-full border flex items-center justify-center flex-shrink-0 ${sel ? "border-indigo-500" : "border-slate-300"}`}>
                                                {sel && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                                              </div>
                                              {s.label}
                                            </label>
                                          );
                                        })}
                                      </div>
                                      {(actVal?.scope === "FACTORY" || actVal?.scope === "WAREHOUSE") && (
                                        <select
                                          className="mt-2 w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                          value={actVal?.scopeValue || ""}
                                          onChange={e => handleChangeScope(mod.key, actKey, "scopeValue", e.target.value)}
                                        >
                                          <option value="">-- Chọn {actVal.scope === "FACTORY" ? "Nhà máy" : "Kho"} --</option>
                                          {actVal.scope === "FACTORY" ? (
                                            <>
                                              <option value="Nhà máy thổi">Nhà máy thổi</option>
                                              <option value="Nhà máy cắt">Nhà máy cắt</option>
                                              <option value="Nhà máy in">Nhà máy in</option>
                                            </>
                                          ) : (
                                            <>
                                              <option value="Kho Nguyên vật liệu">Kho Nguyên vật liệu</option>
                                              <option value="Kho Thành phẩm">Kho Thành phẩm</option>
                                              <option value="Kho Phế liệu">Kho Phế liệu</option>
                                            </>
                                          )}
                                        </select>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   5. PERMISSION EDITOR – Named export (dùng trong Roles.jsx)
═══════════════════════════════════════════════════════════════ */

export function PermissionEditor({ roleName, initialPerms, onSave, onCancel }) {
  const [draft, setDraft] = useState(initialPerms || {});
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => { setDraft(initialPerms || {}); }, [initialPerms]);

  const totalSelected = useMemo(() => {
    let count = 0;
    Object.values(draft).forEach(modDraft => {
      if (modDraft) Object.values(modDraft).forEach(v => {
        if (v?.status === "ALLOW" || v === true) count++;
      });
    });
    return count;
  }, [draft]);

  const handleSelectAll = () => {
    const newDraft = {};
    PERM_TREE.forEach(cat => cat.modules.forEach(mod => {
      newDraft[mod.key] = {};
      mod.actions.forEach(a => { newDraft[mod.key][a] = { status: "ALLOW", scope: "ALL", scopeValue: "" }; });
    }));
    setDraft(newDraft);
  };

  return (
    <div className="bg-slate-50 flex flex-col h-[calc(100vh-80px)] overflow-hidden border border-slate-200 rounded-xl shadow-sm">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-10 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-2 transition-colors text-sm">
            <ArrowLeft size={18} /> Quay lại
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div>
            <div className="text-xs text-slate-500">Đang cấu hình cho vai trò</div>
            <div className="font-bold text-slate-800">{roleName}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setDraft(initialPerms || {})} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium rounded-lg flex items-center gap-2 transition-colors text-sm">
            <RotateCcw size={15} /> Đặt lại
          </button>
          <button onClick={() => onSave(draft)} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg flex items-center gap-2 transition-colors text-sm shadow-md">
            <Save size={15} /> Lưu cấu hình
          </button>
        </div>
      </div>

      {/* Search + Stats */}
      <div className="px-5 py-3 bg-white border-b border-slate-100 flex items-center gap-3 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Tìm chức năng, thao tác, mã quyền..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
        </div>
        <button onClick={handleSelectAll} className="px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 font-medium whitespace-nowrap">Chọn tất cả</button>
        <button onClick={() => { if (window.confirm("Bỏ hết tất cả quyền?")) setDraft({}); }} className="px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 font-medium whitespace-nowrap">Bỏ hết</button>
        <span className="text-sm text-slate-500 whitespace-nowrap">
          <span className="font-bold text-indigo-600">{totalSelected}</span> quyền đã chọn
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <PermTreeEditor draft={draft} setDraft={setDraft} searchQuery={searchQuery} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   6. PERMISSION DRAWER – Right-side overlay
═══════════════════════════════════════════════════════════════ */

function PermissionDrawer({ open, onClose, roleName, initialPerms, onSave, inheritedPerms = {} }) {
  const [draft, setDraft]         = useState(initialPerms || {});
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open) { setDraft(initialPerms || {}); setSearchQuery(""); }
  }, [open, initialPerms]);

  const totalSelected = useMemo(() => {
    let count = 0;
    Object.values(draft).forEach(modDraft => {
      if (modDraft) Object.values(modDraft).forEach(v => {
        if (v?.status === "ALLOW" || v === true) count++;
      });
    });
    return count;
  }, [draft]);

  const allSelected = useMemo(
    () => totalSelected > 0 && PERM_TREE.every(cat => getCategoryState(draft, cat) === "ALL"),
    [draft, totalSelected]
  );
  const someSelected = totalSelected > 0 && !allSelected;

  const handleSelectAll = () => {
    const newDraft = {};
    PERM_TREE.forEach(cat => cat.modules.forEach(mod => {
      newDraft[mod.key] = {};
      mod.actions.forEach(a => { newDraft[mod.key][a] = { status: "ALLOW", scope: "ALL", scopeValue: "" }; });
    }));
    setDraft(newDraft);
  };

  const handleMasterToggle = () => {
    if (allSelected || someSelected) setDraft({});
    else handleSelectAll();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-slate-900/40 z-40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div className={`fixed top-0 right-0 h-full w-[700px] max-w-[96vw] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}>
        
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-indigo-700 bg-gradient-to-r from-indigo-600 to-indigo-700 flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            <div className="text-indigo-200 text-xs font-medium uppercase tracking-wide">Cấu hình quyền</div>
            <div className="text-white font-bold text-lg truncate">{roleName}</div>
          </div>
          <button onClick={onClose} className="p-2 text-indigo-200 hover:text-white hover:bg-indigo-500 rounded-lg transition-colors ml-4 flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* Search + Select All */}
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2 flex-shrink-0">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Tìm chức năng, thao tác, mã quyền (vd: bom.create)..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white" />
          </div>
          <div className="flex items-center gap-1.5">
            <IndeterminateCheckbox
              id="drawer-select-all"
              checked={allSelected}
              indeterminate={someSelected}
              onChange={handleMasterToggle}
            />
            <label htmlFor="drawer-select-all" className="text-sm text-slate-600 cursor-pointer font-medium whitespace-nowrap">
              Chọn tất cả
            </label>
          </div>
        </div>

        {/* Stats bar */}
        <div className="px-4 py-2 bg-white border-b border-slate-100 flex items-center gap-5 flex-shrink-0 text-xs text-slate-500">
          <span><span className="font-bold text-indigo-600 text-sm">{totalSelected}</span> quyền đang chọn</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> 🟢 Trực tiếp
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> 🔵 Kế thừa từ role cha
          </span>
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50">
          <PermTreeEditor
            draft={draft}
            setDraft={setDraft}
            searchQuery={searchQuery}
            inheritedPerms={inheritedPerms}
          />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between flex-shrink-0">
          <button onClick={() => setDraft(initialPerms || {})} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg font-medium flex items-center gap-2 transition-colors">
            <RotateCcw size={14} /> Đặt lại
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-5 py-2 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 font-medium transition-colors">
              Hủy
            </button>
            <button
              onClick={() => onSave(draft)}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 shadow-md transition-colors"
            >
              <Save size={15} /> Lưu cấu hình
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   7. MÀN HÌNH CHÍNH – Default export
═══════════════════════════════════════════════════════════════ */

export default function PermissionsModule() {
  const [roleList, setRoleList]         = useState([]);
  const [roleId, setRoleId]             = useState("");
  const [parentId, setParentId]         = useState("");
  const [perms, setPerms]               = useState({});
  const [effectivePerms, setEffectivePerms] = useState({});
  const [inheritedPerms, setInheritedPerms] = useState({});

  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [searchQuery, setSearchQuery]   = useState("");
  const [expandedCats, setExpandedCats] = useState({});
  const [expandedMods, setExpandedMods] = useState({});

  /* ─── Data fetching ─── */

  const fetchRoles = useCallback(async () => {
    try {
      const res = await roles.list();
      setRoleList(res || []);
      if (res?.length > 0 && !roleId) selectRole(res[0].id, res);
    } catch (e) { console.error(e); }
  }, [roleId]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  const fetchEffective = useCallback(async (id) => {
    try {
      const ep = await roles.getEffectivePermissions(id);
      setEffectivePerms(ep || {});
    } catch (e) { console.error(e); }
  }, []);

  const selectRole = useCallback(async (id, list = roleList) => {
    setRoleId(id);
    if (!id) { setPerms({}); setParentId(""); setEffectivePerms({}); setInheritedPerms({}); return; }
    try {
      const r = await roles.get(id);
      setPerms(r.permissions || {});
      setParentId(r.parent_id || "");
      fetchEffective(id);
    } catch (e) { toast.error("Lỗi tải vai trò: " + e.message); }
  }, [roleList, fetchEffective]);

  /* ─── Tính inherited = effective − direct ─── */
  useEffect(() => {
    if (!parentId) { setInheritedPerms({}); return; }
    const inh = {};
    Object.entries(effectivePerms).forEach(([modKey, actions]) => {
      if (!actions) return;
      Object.entries(actions).forEach(([actKey, val]) => {
        const isAllow = (typeof val === "object" && val.status === "ALLOW") || val === true;
        if (!isAllow) return;
        const isDirect = perms[modKey]?.[actKey] !== undefined;
        if (!isDirect) {
          if (!inh[modKey]) inh[modKey] = {};
          inh[modKey][actKey] = val;
        }
      });
    });
    setInheritedPerms(inh);
  }, [effectivePerms, perms, parentId]);

  const activeRole = roleList.find(r => r.id === roleId);

  /* ─── Flat list để tính KPI ─── */
  const flatEffective = useMemo(() => {
    const list = [];
    Object.entries(effectivePerms).forEach(([modKey, actions]) => {
      if (!actions) return;
      Object.entries(actions).forEach(([actKey, val]) => {
        if (actKey === "fields") return;
        const isAllow = (typeof val === "object" && val.status === "ALLOW") || val === true || val === "ALLOW";
        if (!isAllow) return;
        const isDirect = perms[modKey]?.[actKey] !== undefined;
        list.push({ moduleKey: modKey, actionKey: actKey, isDirect, val });
      });
    });
    return list;
  }, [effectivePerms, perms]);

  /* ─── KPI stats ─── */
  const statTotal    = useMemo(() => PERM_TREE.reduce((s, c) => s + c.modules.reduce((ss, m) => ss + m.actions.length, 0), 0), []);
  const statGranted  = flatEffective.length;
  const statInherited = flatEffective.filter(d => !d.isDirect).length;
  const statDirect   = flatEffective.filter(d => d.isDirect).length;

  /* ─── Tree data for main screen display ─── */
  const mainTreeData = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return PERM_TREE.map(cat => {
      const filteredMods = cat.modules.map(mod => {
        const displayActions = mod.actions.filter(actKey => {
          const ep  = effectivePerms[mod.key]?.[actKey];
          const isAllow = (typeof ep === "object" && ep.status === "ALLOW") || ep === true;
          if (!isAllow) return false;
          if (!q) return true;
          return (
            cat.category.toLowerCase().includes(q) ||
            mod.label.toLowerCase().includes(q) ||
            (ACTION_LABELS[actKey] || actKey).toLowerCase().includes(q) ||
            getPermCode(mod.key, actKey).includes(q)
          );
        });
        if (!displayActions.length) return null;
        return { ...mod, displayActions };
      }).filter(Boolean);
      if (!filteredMods.length) return null;
      return { ...cat, modules: filteredMods };
    }).filter(Boolean);
  }, [effectivePerms, searchQuery]);

  /* ─── Handlers ─── */

  const handleSavePerms = async (newPerms) => {
    try {
      await roles.savePermissions(roleId, newPerms, parentId || null);
      toast.success("Đã lưu phân quyền!");
      setDrawerOpen(false);
      selectRole(roleId);
    } catch (e) { toast.error("Lỗi lưu: " + e.message); }
  };

  const handleDeleteDirectPerm = async (modKey, actKey) => {
    if (!window.confirm("Bạn có chắc muốn gỡ quyền này?")) return;
    try {
      const newPerms = JSON.parse(JSON.stringify(perms));
      if (newPerms[modKey]) {
        delete newPerms[modKey][actKey];
        if (Object.keys(newPerms[modKey]).length === 0) delete newPerms[modKey];
      }
      await roles.savePermissions(roleId, newPerms, parentId || null);
      toast.success("Đã gỡ quyền");
      selectRole(roleId);
    } catch (e) { toast.error("Lỗi: " + e.message); }
  };

  /* ─── Render ─── */

  return (
    <div className="space-y-6">
      <ListHeader title="Phân quyền hệ thống" subtitle="Quản lý quyền truy cập và phạm vi dữ liệu theo vai trò" />

      {/* Control Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-5">
          <div className="flex-1 min-w-[250px]">
            <label className="block text-sm font-semibold text-slate-700 mb-2">Vai trò đang chọn</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              value={roleId} onChange={e => selectRole(e.target.value)}
            >
              <option value="">-- Chọn vai trò --</option>
              {roleList.map(r => <option key={r.id} value={r.id}>{r.role_code} · {r.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[250px]">
            <label className="block text-sm font-medium text-slate-500 mb-2">Kế thừa quyền từ</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-500 focus:ring-indigo-500 outline-none"
              value={parentId}
              disabled={!roleId}
              onChange={async (e) => {
                const newParentId = e.target.value;
                setParentId(newParentId);
                try {
                  await roles.savePermissions(roleId, perms, newParentId || null);
                  fetchEffective(roleId);
                  toast.success(newParentId ? "Đã cập nhật kế thừa quyền" : "Đã bỏ kế thừa quyền");
                } catch (err) { toast.error("Lỗi cập nhật kế thừa: " + err.message); }
              }}
            >
              <option value="">-- Không kế thừa --</option>
              {roleList.filter(r => r.id !== roleId).map(r => <option key={r.id} value={r.id}>{r.role_code} · {r.name}</option>)}
            </select>
          </div>
          <div>
            <button
              onClick={() => setDrawerOpen(true)}
              disabled={!roleId}
              className="h-[38px] px-5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-lg flex items-center gap-2 transition-colors shadow-sm text-sm"
            >
              <Edit size={16} /> Cấu hình quyền
            </button>
          </div>
        </div>
      </div>

      {!roleId ? (
        <div className="bg-white rounded-xl border border-slate-200 border-dashed p-16 flex flex-col items-center text-center">
          <ShieldCheck size={48} className="text-slate-300 mb-4" />
          <p className="text-lg font-semibold text-slate-600">Chưa chọn vai trò</p>
          <p className="text-sm text-slate-400 mt-1">Vui lòng chọn một vai trò ở phía trên để xem và cấu hình quyền.</p>
        </div>
      ) : (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Tổng quyền hệ thống", val: statTotal,    icon: "🔒", color: "text-slate-700",   bg: "bg-white",        border: "border-slate-200" },
              { label: "Quyền được cấp",       val: statGranted,  icon: "✅", color: "text-indigo-600", bg: "bg-indigo-50",    border: "border-indigo-200" },
              { label: "Quyền kế thừa",        val: statInherited,icon: "🔵", color: "text-blue-600",   bg: "bg-blue-50",      border: "border-blue-200" },
              { label: "Quyền trực tiếp",      val: statDirect,   icon: "🟢", color: "text-emerald-600",bg: "bg-emerald-50",   border: "border-emerald-200" },
            ].map((k, i) => (
              <div key={i} className={`${k.bg} rounded-xl border ${k.border} p-5 hover:shadow-md transition-shadow`}>
                <div className="flex items-start justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight">{k.label}</p>
                  <span className="text-lg leading-none">{k.icon}</span>
                </div>
                <p className={`text-3xl font-bold ${k.color}`}>{k.val}</p>
              </div>
            ))}
          </div>

          {/* ── Tree: Chi tiết quyền ── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            {/* Panel header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-500" />
                Chi tiết quyền của vai trò
                {statGranted > 0 && (
                  <span className="bg-indigo-50 text-indigo-600 text-xs font-bold px-2 py-0.5 rounded-full border border-indigo-100">
                    {statGranted} quyền
                  </span>
                )}
              </h3>
              <div className="relative w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  placeholder="Tìm quyền, mã API..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
            </div>

            <div className="p-4 space-y-2 bg-slate-50 min-h-[300px]">
              {mainTreeData.length === 0 ? (
                <div className="py-14 text-center text-slate-400 bg-white rounded-lg border border-slate-200">
                  {statGranted === 0
                    ? "Chưa có quyền nào được cấp cho vai trò này."
                    : "Không tìm thấy quyền phù hợp."}
                </div>
              ) : (
                mainTreeData.map(cat => {
                  const catGranted  = cat.modules.reduce((s, m) => s + m.displayActions.length, 0);
                  const isCatExpand = expandedCats[cat.category] !== false; // default open

                  return (
                    <div key={cat.category} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                      {/* Category row */}
                      <div
                        className="flex items-center gap-3 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                        onClick={() => setExpandedCats(p => ({ ...p, [cat.category]: !isCatExpand }))}
                      >
                        <div className="w-7 h-7 rounded-md bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
                          <cat.icon size={14} />
                        </div>
                        <span className="font-bold text-slate-700 text-sm">{cat.category}</span>
                        <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-semibold">
                          {catGranted} quyền
                        </span>
                        <div className="ml-auto">
                          {isCatExpand
                            ? <ChevronDown size={16} className="text-slate-400" />
                            : <ChevronRight size={16} className="text-slate-400" />}
                        </div>
                      </div>

                      {/* Modules */}
                      {isCatExpand && (
                        <div className="divide-y divide-slate-100">
                          {cat.modules.map(mod => {
                            const isModExpand  = !!expandedMods[mod.key];
                            const directCount  = mod.displayActions.filter(a => {
                              const v = perms[mod.key]?.[a];
                              return v?.status === "ALLOW" || v === true;
                            }).length;
                            const inheritCount = mod.displayActions.length - directCount;

                            return (
                              <div key={mod.key}>
                                {/* Module row */}
                                <div
                                  className="flex items-center gap-3 pl-12 pr-4 py-2.5 cursor-pointer hover:bg-indigo-50/30 transition-colors select-none"
                                  onClick={() => setExpandedMods(p => ({ ...p, [mod.key]: !p[mod.key] }))}
                                >
                                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                    directCount > 0 && inheritCount > 0 ? "bg-purple-400" :
                                    directCount > 0 ? "bg-emerald-400" : "bg-blue-400"
                                  }`} />
                                  <span className="font-semibold text-slate-700 text-sm">{mod.label}</span>
                                  <div className="flex items-center gap-1.5 ml-1">
                                    {directCount > 0 && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 font-medium">
                                        🟢 {directCount}
                                      </span>
                                    )}
                                    {inheritCount > 0 && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 font-medium">
                                        🔵 {inheritCount}
                                      </span>
                                    )}
                                  </div>
                                  <div className="ml-auto flex items-center gap-1.5">
                                    <span className="text-xs text-slate-400">{mod.displayActions.length} thao tác</span>
                                    {isModExpand
                                      ? <ChevronDown size={14} className="text-slate-400" />
                                      : <ChevronRight size={14} className="text-slate-400" />}
                                  </div>
                                </div>

                                {/* Actions */}
                                {isModExpand && (
                                  <div className="pl-16 pr-4 py-2 space-y-1.5 bg-slate-50/60">
                                    {mod.displayActions.map(actKey => {
                                      const isDirect   = perms[mod.key]?.[actKey] !== undefined;
                                      const actVal     = effectivePerms[mod.key]?.[actKey];
                                      const scope      = actVal?.scope || "ALL";
                                      const scopeValue = actVal?.scopeValue || "";
                                      const permCode   = getPermCode(mod.key, actKey);
                                      const { method, path } = getApiInfo(mod.key, actKey);

                                      return (
                                        <div key={actKey} className={`flex items-start gap-3 p-2.5 rounded-lg border transition-all ${
                                          isDirect ? "bg-white border-emerald-200 shadow-sm" : "bg-blue-50/50 border-blue-100"
                                        }`}>
                                          <Check size={14} className={`mt-0.5 flex-shrink-0 ${isDirect ? "text-emerald-500" : "text-blue-400"}`} />
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-sm font-semibold text-slate-700">
                                                {ACTION_LABELS[actKey] || actKey}
                                              </span>
                                              {isDirect ? (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium border border-emerald-200">🟢 Trực tiếp</span>
                                              ) : (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-medium border border-blue-200">🔵 Kế thừa</span>
                                              )}
                                              {scope !== "ALL" && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 font-medium">
                                                  📍 {scope}{scopeValue ? `: ${scopeValue}` : ""}
                                                </span>
                                              )}
                                            </div>
                                            {/* API badges */}
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                              <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${HTTP_BADGE[method] || "bg-slate-50 text-slate-500 border-slate-200"}`}>
                                                {method}
                                              </span>
                                              <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                                                {path}
                                              </span>
                                              <span className="text-[10px] font-mono text-purple-500 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">
                                                {permCode}
                                              </span>
                                            </div>
                                          </div>
                                          {isDirect && (
                                            <button
                                              onClick={() => handleDeleteDirectPerm(mod.key, actKey)}
                                              className="mt-0.5 p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors flex-shrink-0"
                                              title="Gỡ quyền này"
                                            >
                                              <Trash2 size={14} />
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* Drawer */}
      <PermissionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        roleName={activeRole?.name || ""}
        initialPerms={perms}
        onSave={handleSavePerms}
        inheritedPerms={inheritedPerms}
      />
    </div>
  );
}
