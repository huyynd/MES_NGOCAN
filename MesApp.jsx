import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "./src/ui.js";
import { Routes, Route, useNavigate, Navigate, useLocation, NavLink, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  LayoutDashboard, Package, ShoppingCart, Warehouse, Search, Plus, Trash2,
  Upload, Download, RotateCcw, ArrowLeft, Save, CheckCircle2, Activity, Cog,
  Factory, ClipboardList, Database, FlaskConical, ChevronDown, Users, Wrench, MapPin, Pencil, Clock, CalendarDays, QrCode, ScanLine, Shield, ShieldCheck, UserCog, LogOut, GitBranch, Hammer, Copy, Scissors, Wind, Image as ImageIcon, FileText, Eye, Check, Layers, Menu, PanelLeftClose, PanelLeftOpen, Recycle,
} from "lucide-react";
import { getLookups, getDashboard, auth, setToken, getToken, productRelated, nextCode, productFiles } from "./src/mesApi.js";
import Login from "./src/Login.jsx";
import UsersModule from "./src/modules/auth/Users.jsx";
import { PermProvider, usePerm } from "./src/perm.jsx";
import { fmt, fmtDate, statusClass, dueTone } from "./src/ui.js";
import PermissionsModule from "./src/modules/auth/PermissionEditor.jsx";
import RolesModule from "./src/modules/auth/Roles.jsx";
import ProductionModule from "./src/modules/production/Production.jsx";
import ExecutionModule from "./src/modules/production/Execution.jsx";
import PlanningModule, { OrderStatusModule } from "./src/modules/production/Planning.jsx";
import WorkScheduleModule from "./src/modules/production/WorkSchedule.jsx";
import InventoryModule from "./src/modules/inventory/Inventory.jsx";
import InboundModule from "./src/modules/inventory/InboundModule.jsx";
import OutboundModule from "./src/modules/inventory/OutboundModule.jsx";
import TransferModule from "./src/modules/inventory/TransferModule.jsx";
import AdjustModule from "./src/modules/inventory/AdjustModule.jsx";
import TraceabilityLot from "./src/modules/inventory/TraceabilityLot.jsx";
import QrLabelsModule from "./src/modules/inventory/QrLabels.jsx";
import QrScanModule from "./src/modules/inventory/QrScan.jsx";
import MasterDataScreen from "./src/modules/masterData/MasterData.jsx";
import BomModule from "./src/modules/engineering/Bom.jsx";
import ProcessModule from "./src/modules/engineering/Process.jsx";
import OrdersModule from "./src/modules/sales/Orders.jsx";
import DeliveriesModule from "./src/modules/sales/Deliveries.jsx";
import ReportsModule from "./src/modules/reports/Reports.jsx";
import InventoryReport from "./src/modules/reports/InventoryReport.jsx";
import EmployeeReport from "./src/modules/reports/EmployeeReport.jsx";
import OutputReport from "./src/modules/production/OutputReport.jsx";
import ScrapModule from "./src/modules/production/ScrapModule.jsx";
import RecyclingModule from "./src/modules/production/RecyclingModule.jsx";
import { PageHeader, Section, ListHeader, usePager, DataTable, Logo, UnitSelect } from "./src/components.jsx";

/* =====================================================================
   MES — Quản lý Sản phẩm & Dashboard (single-file demo)
   - Mock API thay cho backend Node/Express khi chạy artifact.
   - Trọng tâm: ProductForm xử lý thêm/xóa dòng "Thuộc tính sản phẩm".
   ===================================================================== */

/* ----------------------------- Mock data ----------------------------- */
const PRODUCT_TYPES = ["Thành phẩm", "Bán thành phẩm", "Nguyên vật liệu"];
const AREAS = ["Xưởng thổi", "Xưởng cắt"];

/* ----------------------------- API client ----------------------------- */
/* Gọi backend Node/Express thật. Đổi VITE_API_BASE nếu API chạy nơi khác. */
const API_BASE = import.meta.env?.VITE_API_BASE || "https://mes-ngocan.onrender.com";

async function http(path, opts) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.message) msg = j.message; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

const api = {
  // Trả về mảng sản phẩm (lấy field data từ response phân trang)
  list: async ({ code, name, type, area } = {}) => {
    const q = new URLSearchParams();
    if (code) q.set("code", code);
    if (name) q.set("name", name);
    if (type) q.set("type", type);
    if (area) q.set("area", area);
    q.set("pageSize", "100");
    const { data } = await http(`/api/products?${q.toString()}`);
    return data;
  },
  get: (id) => http(`/api/products/${id}`),
  create: (payload) => http(`/api/products`, { method: "POST", body: JSON.stringify(payload) }),
  update: (id, payload) => http(`/api/products/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  remove: (id) => http(`/api/products/${id}`, { method: "DELETE" }),
  importRows: (rows) => http(`/api/products/import`, { method: "POST", body: JSON.stringify({ rows }) }),
};

// Cột Excel cho Sản phẩm (nhãn ↔ key) — dùng cho Tải mẫu / Nhập / Xuất
const PRODUCT_XLSX_COLS = [
  { key: "product_code", label: "Mã SP" },
  { key: "product_name", label: "Tên sản phẩm" },
  { key: "product_type", label: "Loại" },
  { key: "production_area", label: "Khu vực SX" },
  { key: "category", label: "Danh mục" },
  { key: "product_group", label: "Nhóm SP" },
  { key: "unit", label: "Đơn vị tính" },
  { key: "barcode_type", label: "Loại mã vạch" },
  { key: "tracking_type", label: "Hình thức theo dõi" },
  { key: "status", label: "Trạng thái" },
  { key: "description", label: "Mô tả" },
];

/* ----------------------------- UI helpers ----------------------------- */
const StatusBadge = ({ status }) => {
  const active = status === "Hoạt động";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${active ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-rose-500"}`} />
      {status}
    </span>
  );
};

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
  </div>
);

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition";

/* ============================== SIDEBAR ============================== */

function Sidebar({ user, onLogout, collapsed, onToggle, mobileMenuOpen, onCloseMobile }) {
  const location = useLocation();
  const allItems = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/" },
    {
      key: "grp_sales", label: "Kinh doanh", icon: ShoppingCart,
      children: [
        { key: "orders", label: "Đơn hàng", icon: ShoppingCart, path: "/orders" },
        { key: "deliveries", label: "Phiếu giao hàng", icon: FileText, path: "/deliveries" },
      ]
    },
    {
      key: "grp_plan", label: "Kế hoạch", icon: ClipboardList,
      children: [
        { key: "planning", label: "Kế hoạch sản xuất", icon: ClipboardList, path: "/planning" },
        { key: "workschedule", label: "Lịch sản xuất", icon: CalendarDays, path: "/workschedule" },
      ]
    },
    {
      key: "grp_prod", label: "Sản xuất", icon: Factory,
      children: [
        { key: "production", label: "Lệnh sản xuất", icon: Factory, path: "/production" },
        { key: "orderstatus", label: "Lệnh theo trạng thái", icon: Layers, perm: "orderstatus", path: "/orderstatus" },
        { key: "execution", label: "Thực thi sản xuất", icon: Hammer, path: "/execution" },
        { key: "prod_output", label: "Sản lượng", icon: Activity, path: "/production/output" },
        { key: "qrlabels", label: "In tem xuất xứ", icon: QrCode, path: "/qrlabels" },
      ]
    },
    {
      key: "grp_scrap", label: "Phế phẩm & Tái chế", icon: Recycle,
      children: [
        { key: "scrap", label: "Ghi nhận phế phẩm", icon: Trash2, perm: "scrap", path: "/scrap" },
        { key: "recycling", label: "Quản lý tái chế", icon: Recycle, perm: "recycling", path: "/recycling" },
      ]
    },
    {
      key: "grp_inv", label: "Kho", icon: Warehouse,
      children: [
        { key: "inventory", label: "Tồn kho", icon: Warehouse, path: "/inventory" },
        { key: "inv_inbound", label: "Nhập kho", icon: Download, path: "/inventory/inbound" },
        { key: "inv_outbound", label: "Xuất kho", icon: Upload, path: "/inventory/outbound" },
        { key: "inv_transfer", label: "Chuyển kho", icon: RotateCcw, path: "/inventory/transfer" },
        { key: "inv_adjust", label: "Điều chỉnh tồn kho", icon: Wrench, path: "/inventory/adjust" },
      ]
    },
    {
      key: "grp_trace", label: "Truy xuất", icon: Search,
      children: [
        { key: "qrscan", label: "Tra cứu xuất xứ", icon: Search, path: "/qrscan" },
        { key: "trace_lot", label: "Truy xuất lô", icon: ScanLine, path: "/traceability/lot" },
      ]
    },
    {
      key: "grp_rep", label: "Báo cáo", icon: Activity,
      children: [
        { key: "reports", label: "Báo cáo KPI", icon: Activity, path: "/reports" },
        { key: "rep_inv", label: "Báo cáo kho", icon: Warehouse, path: "/reports/inventory" },
        { key: "rep_employee", label: "Hiệu suất nhân viên", icon: Users, path: "/reports/employees" },
      ]
    },
    {
      key: "grp_master", label: "Thông tin chung", icon: Package,
      children: [
        { key: "products", label: "Sản phẩm", icon: Package, path: "/products" },
        { key: "bom", label: "Định mức (BOM)", icon: FlaskConical, path: "/bom" },
        { key: "process", label: "Quy trình công nghệ", icon: GitBranch, path: "/process" },
        { key: "md:machines", label: "Máy móc", icon: Wrench, path: "/master-data/machines", perm: "md_machines" },
        { key: "md:employees", label: "Nhân viên", icon: Users, path: "/master-data/employees", perm: "md_employees" },
        { key: "md:shifts", label: "Ca làm việc", icon: Clock, path: "/master-data/shifts", perm: "md_shifts" },
        { key: "md:warehouses", label: "Kho (danh mục)", icon: Warehouse, path: "/master-data/warehouses", perm: "md_warehouses" },
        { key: "md:zones", label: "Khu vực", icon: MapPin, path: "/master-data/zones", perm: "md_zones" },
        { key: "md:locations", label: "Vị trí lưu trữ", icon: MapPin, path: "/master-data/locations", perm: "md_locations" },
        { key: "md:customers", label: "Khách hàng", icon: Users, path: "/master-data/customers", perm: "md_customers" },
      ]
    },
    {
      key: "grp_sys", label: "Quản trị hệ thống", icon: Shield,
      children: [
        { key: "users", label: "Tài khoản", icon: UserCog, perm: "sys_users", path: "/users" },
        { key: "md:roles", label: "Vai trò", icon: Shield, path: "/master-data/roles", perm: "md_roles" },
        { key: "permissions", label: "Phân quyền hệ thống", icon: ShieldCheck, perm: "sys_permissions", path: "/permissions" },
      ]
    }
  ];

  const isAdmin = !!user?.is_admin;

  const checkPerm = (it) => {
    if (isAdmin || it.always) return true;
    if (it.adminOnly) return false;
    const v = user?.permissions?.[it.perm || it.key]?.view;
    return v === 'ALLOW' || v === true || v?.status === 'ALLOW';
  };

  const items = allItems.map(it => {
    if (it.children) {
      return { ...it, children: it.children.filter(checkPerm) };
    }
    return it;
  }).filter(it => {
    if (it.children) return it.children.length > 0;
    return checkPerm(it);
  });

  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState("");
  const isSearchActive = search.trim().length > 0;

  const filteredItems = items.map(it => {
    const term = search.toLowerCase();
    if (it.children) {
      const matchC = it.children.filter(c => c.label.toLowerCase().includes(term));
      if (matchC.length > 0 || it.label.toLowerCase().includes(term)) {
        return { ...it, children: matchC.length > 0 ? matchC : it.children };
      }
      return null;
    }
    return it.label.toLowerCase().includes(term) ? it : null;
  }).filter(Boolean);

  const itemCls = (isActive) =>
    `w-full flex items-center ${collapsed ? "justify-center" : "gap-3 px-3"} py-2.5 rounded-lg text-sm font-medium transition ${isActive ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-blue-50 hover:text-blue-700"}`;

  return (
    <>
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-40 md:hidden" onClick={onCloseMobile} />
      )}
      <aside className={`fixed inset-y-0 left-0 z-50 transform ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"} md:relative md:translate-x-0 ${collapsed ? "md:w-16 w-60" : "w-60"} shrink-0 bg-white border-r border-slate-200 text-slate-600 h-screen flex flex-col transition-all duration-300`}>
        <div className={`px-4 py-4 border-b border-slate-100 shrink-0 flex items-center ${collapsed ? 'justify-center' : 'gap-3'} transition-all`}>
          <button onClick={onToggle} className="hidden md:block p-1 shrink-0 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition" title="Thu gọn/Mở rộng menu">
            <Menu size={20} />
          </button>
          <button onClick={onCloseMobile} className="md:hidden p-1 shrink-0 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition" title="Đóng menu">
            <ArrowLeft size={20} />
          </button>
          {!collapsed && (
            <div className="flex-1 flex flex-col items-center pr-6">
              <Logo className="max-h-10 max-w-full w-auto object-contain" />
              <div className="text-[11px] text-slate-400 mt-0.5">Hệ thống MES</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <div className="px-3 py-3 border-b border-slate-100 shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder="Tìm module..."
              />
            </div>
          </div>
        )}
        <nav className={`nav-scroll flex-1 min-h-0 overflow-y-auto ${collapsed ? "px-2" : "px-3"} py-4 space-y-1`}>
          {filteredItems.map((it, idx) => {
            const Icon = it.icon;
            if (it.children) {
              const childActive = it.children.some((c) => location.pathname.startsWith(c.path));
              const open = isSearchActive || (expanded[it.key] ?? childActive);
              return (
                <div key={it.key}>
                  <button onClick={() => { if (!collapsed) setExpanded((e) => ({ ...e, [it.key]: !(e[it.key] ?? childActive) })) }}
                    className={itemCls(false)} title={collapsed ? it.label : undefined}>
                    <Icon size={18} className="shrink-0" />
                    {!collapsed && <span className="flex-1 text-left truncate">{it.label}</span>}
                    {!collapsed && <ChevronDown size={16} className={`transition ${open ? "rotate-180" : ""}`} />}
                  </button>
                  {open && !collapsed && (
                    <div className="mt-1 ml-4 pl-3 border-l border-slate-200 space-y-1">
                      {it.children.map((c) => (
                        <NavLink key={c.key} to={c.path} end={true} onClick={() => onCloseMobile?.()}
                          className={({ isActive }) => {
                            const active = isActive || (c.key === 'products' && location.pathname.startsWith('/products'));
                            return `w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${active ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-blue-50 hover:text-blue-700"}`;
                          }}>
                          <c.icon size={15} className="shrink-0" /> <span className="truncate">{c.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <NavLink key={it.key} to={it.path} end={it.key !== 'products'} onClick={() => onCloseMobile?.()} className={({ isActive }) => itemCls(isActive || (it.key === 'products' && location.pathname.startsWith('/products')))} title={collapsed ? it.label : undefined}>
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="truncate">{it.label}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className={`px-4 py-3 border-t border-slate-100 shrink-0 ${collapsed ? "flex flex-col items-center gap-3 px-2" : ""}`}>
          <div className={`flex items-center gap-2 ${collapsed ? "justify-center mb-0" : "mb-2"}`}>
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0" title={collapsed ? (user?.full_name || user?.username) : undefined}>
              {(user?.full_name || user?.username || "?").charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{user?.full_name || user?.username}</div>
                <div className="text-[11px] text-slate-400 truncate">{user?.role_name || (user?.is_admin ? "Quản trị" : "—")}</div>
              </div>
            )}
          </div>
          <button onClick={onLogout} className={`flex items-center justify-center gap-2 rounded-lg text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition ${collapsed ? "w-10 h-10 p-0" : "w-full px-3 py-2"}`} title={collapsed ? "Đăng xuất" : undefined}>
            <LogOut size={16} className="shrink-0" /> {!collapsed && "Đăng xuất"}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ============================ PRODUCT LIST ============================ */
function ProductList({ onOpen, onCreate, onCopy }) {
  const { can } = usePerm();
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    try { setRows(await api.list({})); }
    catch (e) { console.error(e); toast.error("Lỗi tải danh sách: " + e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const del = async (id) => {
    if (!confirm("Xóa sản phẩm này?")) return;
    try { await api.remove(id); toast.success("Đã xóa thành công"); load(); }
    catch (e) { toast.error("Lỗi xóa sản phẩm: " + e.message); }
  };

  // Tải file mẫu (chỉ tiêu đề)
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([PRODUCT_XLSX_COLS.map((c) => c.label)]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "SanPham");
    XLSX.writeFile(wb, "mau-san-pham.xlsx");
  };
  // Xuất danh sách hiện tại
  const exportExcel = () => {
    const data = rows.map((r) => {
      const o = {};
      PRODUCT_XLSX_COLS.forEach((c) => {
        o[c.label] = c.key === "product_type"
          ? (r.product_types && r.product_types.length ? r.product_types.join(", ") : r.product_type)
          : (r[c.key] ?? "");
      });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data, { header: PRODUCT_XLSX_COLS.map((c) => c.label) });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "SanPham");
    XLSX.writeFile(wb, "san-pham.xlsx");
  };
  // Nhập từ Excel — chặn trùng mã/tên ở backend
  const importExcel = async (file) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const payloads = json.map((row) => {
        const p = {};
        PRODUCT_XLSX_COLS.forEach((c) => { const v = row[c.label]; if (v !== undefined && v !== "") p[c.key] = typeof v === "string" ? v.trim() : v; });
        return p;
      }).filter((p) => p.product_name);
      if (!payloads.length) return toast.error("Không đọc được dòng hợp lệ. Kiểm tra cột tiêu đề khớp file mẫu (cần cột 'Tên sản phẩm').");
      const res = await api.importRows(payloads);
      let msg = `Đã nhập ${res.inserted}/${payloads.length} sản phẩm.`;
      if (res.failed) msg += `\nBỏ qua ${res.failed} dòng:\n` + res.errors.map((e) => `· Dòng ${e.row}: ${e.message}`).join("\n");
      toast.error(msg); load();
    } catch (e) { toast.error("Lỗi đọc file: " + e.message); }
  };

  const columns = [
    { key: "product_code", label: "Mã SP", filter: "text", render: (p) => <button onClick={() => onOpen(p.id)} className="text-blue-600 font-medium hover:underline">{p.product_code}</button> },
    { key: "product_name", label: "Tên sản phẩm", filter: "text", tdClass: "text-slate-800" },
    { key: "status", label: "Trạng thái", filter: "select", render: (p) => <StatusBadge status={p.status} /> },
    {
      key: "product_type", label: "Loại", filter: "select", tdClass: "text-slate-600",
      filterValue: (r) => (r.product_types && r.product_types.length ? r.product_types.join(", ") : r.product_type),
      render: (r) => (r.product_types && r.product_types.length ? r.product_types.join(", ") : r.product_type)
    },
    { key: "description", label: "Mô tả", filter: "text", tdClass: "text-slate-500 max-w-xs truncate" },
    {
      key: "_act", label: "Hành động", align: "center", render: (p) => (<>
        {can("products", "create") && <button onClick={() => onCopy(p.id)} title="Sao chép thành SP mới" className="text-slate-400 hover:text-blue-600 transition p-1"><Copy size={16} /></button>}
        <button onClick={() => del(p.id)} title="Xóa" className="text-slate-400 hover:text-rose-600 transition p-1"><Trash2 size={16} /></button>
      </>)
    },
  ];

  return (
    <div className="space-y-5">
      <ListHeader title="Danh sách sản phẩm" actions={<>
        <button onClick={downloadTemplate} className="btn-ghost"><FileText size={16} /> Tải mẫu</button>
        {can("products", "create") && (
          <label className="btn-ghost cursor-pointer"><Upload size={16} /> Nhập Excel
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files[0]) importExcel(e.target.files[0]); e.target.value = ""; }} />
          </label>
        )}
        <button onClick={exportExcel} className="btn-ghost"><Download size={16} /> Xuất Excel</button>
        <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        {can("products", "create") && <button onClick={onCreate} className="btn-primary"><Plus size={16} /> Thêm mới</button>}
      </>} />
      <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} emptyText="Không có dữ liệu" />
    </div>
  );
}

/* ===== Trường thông tin sản phẩm — DÙNG CHUNG cho màn xem & sửa ===== */
/* disabled=true → chế độ xem (chỉ đọc); false → chỉnh sửa. Cùng một layout. */
/* Dropdown chọn nhiều giá trị (value list), hiển thị như ô select thường */
function MultiSelect({ options, value, onChange, disabled, placeholder = "-- Chọn --" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const arr = value || [];
  const toggle = (o) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)}
        className={inputCls + " flex items-center justify-between text-left" + (disabled ? " bg-slate-50 text-slate-800" : "")}>
        <span className={arr.length ? "text-slate-800 truncate" : "text-slate-400"}>{arr.length ? arr.join(", ") : placeholder}</span>
        <ChevronDown size={16} className="text-slate-400 shrink-0 ml-2" />
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {options.map((o) => {
            const on = arr.includes(o);
            return (
              <button type="button" key={o} onClick={() => toggle(o)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-50 ${on ? "text-blue-600 font-medium bg-blue-50/50" : "text-slate-700"}`}>
                {o}{on && <Check size={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductFields({ form, set, disabled, code }) {
  const { fperm } = usePerm();
  const hid = (k) => fperm("products", k) === "hidden";
  const dis = (k) => disabled || fperm("products", k) !== "edit";
  const cls = (k, extra = "") => inputCls + extra + (dis(k) ? " bg-slate-50 text-slate-800" : "");
  return (
    <>
      <Section title="Thông tin chung">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          {/* Hàng 1: định danh */}
          <Field label="Mã sản phẩm">
            <input className={inputCls + " bg-slate-50 text-slate-500"} disabled value={code || "(tự sinh khi lưu)"} />
          </Field>
          {!hid("product_name") && <Field label="Tên sản phẩm" required>
            <input className={cls("product_name")} disabled={dis("product_name")} value={form.product_name} onChange={(e) => set("product_name", e.target.value)} />
          </Field>}
          {!hid("description") && <Field label="Mô tả">
            <input className={cls("description")} disabled={dis("description")} value={form.description || ""} onChange={(e) => set("description", e.target.value)} />
          </Field>}

          {/* Hàng 2: phân loại sản xuất */}
          {!hid("product_type") && <Field label="Loại sản phẩm" required>
            <MultiSelect options={PRODUCT_TYPES} value={form.product_types} disabled={dis("product_type")}
              onChange={(v) => set("product_types", v)} />
          </Field>}
          {!hid("production_area") && <Field label="Khu vực sản xuất">
            <select className={cls("production_area")} disabled={dis("production_area")} value={form.production_area || ""} onChange={(e) => set("production_area", e.target.value)}>
              <option value="">-- Chọn --</option>{AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </Field>}
          {!hid("unit") && <Field label="Đơn vị tính">
            <UnitSelect value={form.unit || ""} disabled={dis("unit")} onChange={(v) => set("unit", v)} />
          </Field>}

          {/* Hàng 3: phân nhóm */}
          {!hid("category") && <Field label="Danh mục">
            <input className={cls("category")} disabled={dis("category")} value={form.category || ""} onChange={(e) => set("category", e.target.value)} />
          </Field>}
          {!hid("product_group") && <Field label="Nhóm sản phẩm">
            <input className={cls("product_group")} disabled={dis("product_group")} value={form.product_group || ""} onChange={(e) => set("product_group", e.target.value)} />
          </Field>}

          {/* Hàng 4: theo dõi / mã vạch */}
          {!hid("tracking_type") && <Field label="Hình thức theo dõi">
            <select className={cls("tracking_type")} disabled={dis("tracking_type")} value={form.tracking_type || ""} onChange={(e) => set("tracking_type", e.target.value)}>
              <option>Theo lô</option><option>Theo serial</option>
            </select>
          </Field>}
          {!hid("barcode_type") && <Field label="Loại mã vạch">
            <select className={cls("barcode_type")} disabled={dis("barcode_type")} value={form.barcode_type || ""} onChange={(e) => set("barcode_type", e.target.value)}>
              <option value="">-- Chọn --</option><option>CODE128</option><option>QR</option><option>EAN13</option>
            </select>
          </Field>}
          <div className="flex items-end gap-6">
            {!hid("is_pqc_required") && <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" disabled={dis("is_pqc_required")} checked={!!form.is_pqc_required}
                onChange={(e) => set("is_pqc_required", e.target.checked)} className="w-4 h-4 accent-blue-600" />
              Cần kiểm tra PQC
            </label>}
            {!hid("status") && <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" disabled={dis("status")} checked={form.status === "Hoạt động"}
                onChange={(e) => set("status", e.target.checked ? "Hoạt động" : "Không hoạt động")}
                className="w-4 h-4 accent-emerald-600" />
              Hoạt động
            </label>}
          </div>
        </div>
      </Section>

    </>
  );
}

function WarehouseLimitsList({ limits, setLimits, lookups, disabled, productUnit }) {
  const addLimit = () => setLimits((l) => [...l, { _key: Date.now(), warehouse_id: "", min_quantity: "", max_quantity: "" }]);
  const removeLimit = (key) => setLimits((l) => l.filter((x) => x._key !== key));
  const updateLimit = (key, field, val) => setLimits((l) => l.map((x) => (x._key === key ? { ...x, [field]: val } : x)));

  return (
    <Section title="Định mức theo Kho" action={!disabled && (
      <button onClick={addLimit} className="btn-ghost text-blue-600 border-blue-200 hover:bg-blue-50">
        <Plus size={16} /> Thêm kho
      </button>
    )}>
      {(!limits || limits.length === 0) && <div className="text-sm text-slate-400 py-2">Chưa cấu hình định mức kho.</div>}
      {limits && limits.length > 0 && (
        <div className="space-y-3">
          {limits.map((l) => (
            <div key={l._key || l.warehouse_id} className="flex flex-wrap items-center gap-4 attr-row p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-slate-500 mb-1">Kho chứa</label>
                <select className={inputCls} disabled={disabled} value={l.warehouse_id || ""} onChange={(e) => updateLimit(l._key, "warehouse_id", e.target.value)}>
                  <option value="">-- Chọn Kho --</option>
                  {(lookups?.warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="w-32">
                <label className="block text-xs font-medium text-slate-500 mb-1">Tồn tối thiểu</label>
                <div className="relative">
                  <input type="number" min="0" className={inputCls + (productUnit ? " pr-10" : "")} disabled={disabled} value={l.min_quantity || ""} onChange={(e) => updateLimit(l._key, "min_quantity", e.target.value)} placeholder="0" />
                  {productUnit && <span className="absolute right-2.5 top-1.5 text-[11px] text-slate-400 font-medium pointer-events-none">{productUnit}</span>}
                </div>
              </div>
              <div className="w-32">
                <label className="block text-xs font-medium text-slate-500 mb-1">Tồn tối đa</label>
                <div className="relative">
                  <input type="number" min="0" className={inputCls + (productUnit ? " pr-10" : "")} disabled={disabled} value={l.max_quantity || ""} onChange={(e) => updateLimit(l._key, "max_quantity", e.target.value)} placeholder="0" />
                  {productUnit && <span className="absolute right-2.5 top-1.5 text-[11px] text-slate-400 font-medium pointer-events-none">{productUnit}</span>}
                </div>
              </div>
              {!disabled && (
                <button onClick={() => removeLimit(l._key)} className="mt-5 p-2 text-rose-500 hover:bg-rose-100 rounded-md transition" title="Xóa">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ============================ PRODUCT FORM ============================ */
function ProductForm({ productId, copyId, onBack, onSaved, lookups }) {
  const [form, setForm] = useState({
    product_name: "", production_area: "", category: "", product_types: ["Thành phẩm"],
    product_group: "", unit: "Cm", barcode_type: "", tracking_type: "Theo lô",
    is_pqc_required: false, status: "Hoạt động", description: "",
  });
  const [warehouseLimits, setWarehouseLimits] = useState([]);
  // mỗi attr có _key ổn định để React render mượt khi thêm/xóa
  const [attributes, setAttributes] = useState([{ _key: 1, name: "", value: "" }]);
  const [keySeq, setKeySeq] = useState(2);
  const [code, setCode] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Mã dự kiến khi thêm mới
  useEffect(() => { if (!productId) nextCode("products").then(setCode).catch(() => { }); }, [productId]);

  // Sao chép từ sản phẩm nguồn → SP mới
  useEffect(() => {
    if (productId || !copyId) return;
    api.get(copyId).then((d) => {
      setForm({
        product_name: (d.product_name || "") + " (copy)", production_area: d.production_area || "", category: d.category || "",
        product_types: (d.product_types && d.product_types.length) ? d.product_types : (d.product_type ? [d.product_type] : ["Thành phẩm"]), product_group: d.product_group || "", unit: d.unit || "",
        barcode_type: d.barcode_type || "", tracking_type: d.tracking_type || "Theo lô",
        is_pqc_required: !!d.is_pqc_required, status: d.status || "Hoạt động", description: d.description || "",
      });
      const whLimits = (d.warehouse_limits || []).map((w, i) => ({ _key: i + 1, ...w }));
      setWarehouseLimits(whLimits);
      const attrs = (d.attributes || []).map((a, i) => ({ _key: i + 1, name: a.name, value: a.value }));
      setAttributes(attrs.length ? attrs : [{ _key: 1, name: "", value: "" }]);
      setKeySeq((attrs.length || 1) + 1);
    }).catch((e) => toast.error("Lỗi tải SP nguồn: " + e.message));
  }, [copyId, productId]);

  // Nạp dữ liệu khi sửa
  useEffect(() => {
    if (!productId) return;
    api.get(productId).then((d) => {
      setCode(d.product_code || "");
      setForm({
        product_name: d.product_name || "", production_area: d.production_area || "", category: d.category || "",
        product_types: (d.product_types && d.product_types.length) ? d.product_types : (d.product_type ? [d.product_type] : ["Thành phẩm"]), product_group: d.product_group || "", unit: d.unit || "",
        barcode_type: d.barcode_type || "", tracking_type: d.tracking_type || "Theo lô",
        is_pqc_required: !!d.is_pqc_required, status: d.status || "Hoạt động", description: d.description || "",
      });
      const whLimits = (d.warehouse_limits || []).map((w, i) => ({ _key: i + 1, ...w }));
      setWarehouseLimits(whLimits);
      const attrs = (d.attributes || []).map((a, i) => ({ _key: i + 1, name: a.name, value: a.value }));
      setAttributes(attrs.length ? attrs : [{ _key: 1, name: "", value: "" }]);
      setKeySeq((attrs.length || 1) + 1);
    }).catch((e) => toast.error("Lỗi tải sản phẩm: " + e.message));
  }, [productId]);

  const addAttr = () => {
    setAttributes((a) => [...a, { _key: keySeq, name: "", value: "" }]);
    setKeySeq((s) => s + 1);
  };
  const removeAttr = (key) => setAttributes((a) => a.filter((x) => x._key !== key));
  const updateAttr = (key, field, val) =>
    setAttributes((a) => a.map((x) => (x._key === key ? { ...x, [field]: val } : x)));

  const save = async () => {
    if (!form.product_name) return toast.error("Vui lòng nhập Tên sản phẩm");
    const cleanAttrs = attributes
      .filter((a) => a.name && a.value)
      .map(({ name, value }) => ({ name, value }));
    const cleanLimits = warehouseLimits.map(({ warehouse_id, min_quantity, max_quantity }) => ({ warehouse_id, min_quantity, max_quantity }));
    try {
      if (productId) await api.update(productId, { ...form, attributes: cleanAttrs, warehouse_limits: cleanLimits });
      else await api.create({ ...form, attributes: cleanAttrs, warehouse_limits: cleanLimits });
      toast.success("Đã lưu thành công"); onSaved();
    } catch (e) {
      toast.error("Lỗi lưu sản phẩm: " + e.message);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={productId ? "Sửa sản phẩm" : (copyId ? "Thêm mới sản phẩm (sao chép)" : "Thêm mới sản phẩm")} onBack={onBack}
        actions={<button onClick={save} className="btn-primary"><Save size={16} /> Lưu sản phẩm</button>} />

      <ProductFields form={form} set={set} code={code} disabled={false} />
      <WarehouseLimitsList limits={warehouseLimits} setLimits={setWarehouseLimits} lookups={lookups} disabled={false} productUnit={form.unit} />

      <style>{`
        .attr-row { animation: slideIn .18s ease; }
        @keyframes slideIn { from { opacity:0; transform: translateY(-4px);} to {opacity:1; transform:none;} }
      `}</style>
    </div>
  );
}

/* =========================== PRODUCT DETAIL =========================== */
function ProductDetail({ id, onBack, onDeleted, onOpenOrder, onOpenProductionOrder, lookups }) {
  const { can } = usePerm();
  const [tab, setTab] = useState("info");
  const [p, setP] = useState(null);
  const [related, setRelated] = useState({ salesOrders: [], productionOrders: [] });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [warehouseLimits, setWarehouseLimits] = useState([]);
  const [attributes, setAttributes] = useState([]);
  const [keySeq, setKeySeq] = useState(1);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const addAttr = () => { setAttributes((a) => [...a, { _key: keySeq, name: "", value: "" }]); setKeySeq((s) => s + 1); };
  const removeAttr = (key) => setAttributes((a) => a.filter((x) => x._key !== key));
  const updateAttr = (key, fld, val) => setAttributes((a) => a.map((x) => (x._key === key ? { ...x, [fld]: val } : x)));

  const load = () => {
    if (!id) { onBack(); return Promise.resolve(); }
    return api.get(id).then((d) => {
      setP(d);
      setForm({
        product_name: d.product_name || "", production_area: d.production_area || "", category: d.category || "",
        product_types: (d.product_types && d.product_types.length) ? d.product_types : (d.product_type ? [d.product_type] : ["Thành phẩm"]), product_group: d.product_group || "", unit: d.unit || "",
        barcode_type: d.barcode_type || "", tracking_type: d.tracking_type || "Theo lô",
        is_pqc_required: !!d.is_pqc_required, status: d.status || "Hoạt động", description: d.description || "",
      });
      const whLimits = (d.warehouse_limits || []).map((w, i) => ({ _key: i + 1, ...w }));
      setWarehouseLimits(whLimits);
      const attrs = (d.attributes || []).map((a, i) => ({ _key: i + 1, name: a.name, value: a.value }));
      setAttributes(attrs.length ? attrs : [{ _key: 1, name: "", value: "" }]);
      setKeySeq((attrs.length || 1) + 1);
    }).catch((e) => toast.error("Lỗi tải chi tiết: " + e.message));
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  useEffect(() => { if (id) productRelated(id).then(setRelated).catch(() => { }); }, [id]);

  // Tài liệu / hình ảnh đính kèm
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const loadFiles = () => {
    if (!id) return;
    productFiles.list(id).then((r) => { setFiles(r.data || []); setPreview(r.preview || null); }).catch(() => { });
  };
  useEffect(() => { loadFiles(); }, [id]); // eslint-disable-line
  const onUpload = async (fileList) => {
    const arr = [...(fileList || [])]; if (!arr.length) return;
    setUploading(true);
    try {
      for (const f of arr) {
        const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        await productFiles.add(id, { name: f.name, content_type: f.type, data: dataUrl });
      }
      toast.success("Đã tải lên tài liệu thành công");
      loadFiles();
    } catch (e) { toast.error("Lỗi tải lên: " + e.message); }
    finally { setUploading(false); }
  };
  const viewFile = async (att) => {
    try { const f = await productFiles.file(id, att.id); const w = window.open("", "_blank"); if (w) w.document.write(`<title>${f.name}</title><iframe src="${f.data}" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`); }
    catch (e) { toast.error("Lỗi xem tài liệu: " + e.message); }
  };
  const delFile = async (att) => { if (!confirm("Xóa tài liệu này?")) return; try { await productFiles.remove(id, att.id); toast.success("Đã xóa tài liệu"); loadFiles(); } catch (e) { toast.error("Lỗi xóa: " + e.message); } };

  const del = async () => {
    if (!confirm("Xóa sản phẩm này?")) return;
    try { await api.remove(id); toast.success("Đã xóa sản phẩm"); onDeleted?.(); } catch (e) { toast.error("Lỗi xóa: " + e.message); }
  };
  const save = async () => {
    if (!form.product_name) return toast.error("Vui lòng nhập Tên sản phẩm");
    const cleanAttrs = attributes.filter((a) => a.name && a.value).map(({ name, value }) => ({ name, value }));
    const cleanLimits = warehouseLimits.map(({ warehouse_id, min_quantity, max_quantity }) => ({ warehouse_id, min_quantity, max_quantity }));
    try { await api.update(id, { ...form, attributes: cleanAttrs, warehouse_limits: cleanLimits }); toast.success("Lưu sản phẩm thành công"); await load(); setEditing(false); }
    catch (e) { toast.error("Lỗi lưu sản phẩm: " + e.message); }
  };
  const cancel = () => { load(); setEditing(false); };

  const tabs = [
    { key: "info", label: "Thông tin sản phẩm" },
    { key: "prod", label: "Thông tin sản xuất" },
    { key: "stock", label: "Thông tin tồn kho" },
    { key: "related", label: "Đơn hàng & Lệnh SX" },
  ];

  if (!p || !form) return <div className="text-slate-400 text-sm py-10">Đang tải chi tiết sản phẩm…</div>;

  return (
    <div className="space-y-5">
      <PageHeader title={<span className="inline-flex items-center gap-2">{preview && <img src={preview.data} alt="" className="w-8 h-8 rounded-md object-cover border border-slate-200" />}{p.product_name}</span>} onBack={onBack}
        badge={<StatusBadge status={p.status} />} subtitle={p.product_code}
        actions={editing ? (<>
          <button onClick={cancel} className="btn-ghost">Hủy</button>
          <button onClick={save} className="btn-primary"><Save size={16} /> Lưu</button>
        </>) : (<>
          {can("products", "edit") && <button onClick={() => { setTab("info"); setEditing(true); }} className="btn-ghost"><Pencil size={16} /> Sửa</button>}
          {can("products", "delete") && <button onClick={del} className="btn-ghost" style={{ color: "#e11d48" }}><Trash2 size={16} /> Xóa</button>}
        </>)} />

      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition ${tab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <>
          <ProductFields disabled={!editing} form={form} set={set} code={p.product_code} />
          <WarehouseLimitsList limits={warehouseLimits} setLimits={setWarehouseLimits} lookups={lookups} disabled={!editing} productUnit={form.unit} />

          <Section title="Hình ảnh & tài liệu"
            action={can("products", "edit") && (
              <label className="btn-ghost text-blue-600 border-blue-200 hover:bg-blue-50 cursor-pointer">
                <Upload size={16} /> Tải lên
                <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden"
                  onChange={(e) => { onUpload(e.target.files); e.target.value = ""; }} />
              </label>
            )}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Ô preview hình ảnh mới nhất */}
              <div>
                {preview ? (
                  <a href={preview.data} target="_blank" rel="noreferrer" title="Bấm để xem lớn">
                    <img src={preview.data} alt={preview.name} className="w-full rounded-lg border border-slate-200 object-contain max-h-56 bg-slate-50" />
                  </a>
                ) : (
                  <div className="h-44 rounded-lg border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
                    <ImageIcon size={26} /> Chưa có hình ảnh
                  </div>
                )}
                {preview && <div className="text-xs text-slate-400 mt-2 truncate">{preview.name}</div>}
              </div>

              {/* Danh sách tài liệu */}
              <div className="lg:col-span-2">
                {uploading && <div className="text-sm text-blue-600 mb-2">Đang tải lên…</div>}
                {!files.length ? (
                  <div className="text-sm text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-lg h-full flex items-center justify-center">
                    Chưa có tài liệu. Bấm "Tải lên" để thêm ảnh / PDF / Word / Excel.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {files.map((f) => (
                      <div key={f.id} className="flex items-center gap-3 py-2.5">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${f.is_image ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"}`}>
                          {f.is_image ? <ImageIcon size={18} /> : <FileText size={18} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-800 truncate">{f.name}</div>
                          <div className="text-[11px] text-slate-400">{f.content_type || "—"} · {fmtDate(f.created_at)}</div>
                        </div>
                        <button onClick={() => viewFile(f)} className="text-slate-400 hover:text-blue-600 p-1" title="Xem"><Eye size={16} /></button>
                        {can("products", "edit") && <button onClick={() => delFile(f)} className="text-slate-400 hover:text-rose-600 p-1" title="Xóa"><Trash2 size={16} /></button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Section>
        </>
      )}

      {tab === "prod" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">Danh sách định mức (BOM)</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr><th className="text-left px-4 py-2">Mã BOM</th><th className="text-left px-4 py-2">Sản phẩm</th>
                  <th className="text-right px-4 py-2">Số lượng</th><th className="text-left px-4 py-2">Đơn vị</th>
                  <th className="text-left px-4 py-2">Loại BOM</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {p.boms.map((b) => (
                  <tr key={b.bom_code}><td className="px-4 py-2 text-blue-600">{b.bom_code}</td>
                    <td className="px-4 py-2">{b.product}</td><td className="px-4 py-2 text-right">{b.quantity}</td>
                    <td className="px-4 py-2">{b.unit}</td><td className="px-4 py-2">{b.bom_type}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold text-slate-700 border-b border-slate-100">Danh sách quy trình</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr><th className="text-left px-4 py-2">Bước</th><th className="text-left px-4 py-2">Công đoạn</th>
                  <th className="text-left px-4 py-2">Xưởng</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {p.processes.map((s) => (
                  <tr key={s.step}><td className="px-4 py-2">{s.step}</td><td className="px-4 py-2">{s.name}</td>
                    <td className="px-4 py-2">{s.workshop}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "stock" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr><th className="text-left px-4 py-2">Kho</th><th className="text-right px-4 py-2">SL hiện tại</th>
                <th className="text-right px-4 py-2">SL dự kiến</th><th className="text-left px-4 py-2">Đơn vị</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.inventory.map((w) => (
                <tr key={w.warehouse}><td className="px-4 py-2">{w.warehouse}</td>
                  <td className="px-4 py-2 text-right font-medium">{w.current_qty.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{w.expected_qty.toLocaleString()}</td>
                  <td className="px-4 py-2">{w.unit}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "related" && (
        <div className="space-y-6">
          <Section title={`Đơn hàng có sản phẩm này (${related.salesOrders.length})`} bodyClass="p-0">
            {related.salesOrders.length === 0 ? <div className="p-6 text-slate-400 text-sm">Chưa có đơn hàng.</div> : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>{["Mã đơn", "Khách hàng", "Ngày đặt", "Số lượng", "Trạng thái"].map((h) =>
                    <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {related.salesOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3"><button onClick={() => onOpenOrder?.(o.id)} className="font-medium text-blue-600 hover:underline">{o.order_code}</button></td>
                      <td className="px-4 py-3 text-slate-700">{o.customer_name || "—"}</td>
                      <td className="px-4 py-3">{fmtDate(o.order_date)}</td>
                      <td className="px-4 py-3">{fmt(o.quantity)} {o.unit || ""}</td>
                      <td className="px-4 py-3"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(o.status)}`}>{o.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title={`Lệnh sản xuất của sản phẩm này (${related.productionOrders.length})`} bodyClass="p-0">
            {related.productionOrders.length === 0 ? <div className="p-6 text-slate-400 text-sm">Chưa có lệnh sản xuất.</div> : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>{["Mã lệnh", "Khách hàng", "Máy", "Số lượng", "Ngày SX", "Trạng thái"].map((h) =>
                    <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {related.productionOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3"><button onClick={() => onOpenProductionOrder?.(o.id)} className="font-medium text-blue-600 hover:underline">{o.order_code}</button></td>
                      <td className="px-4 py-3 text-slate-700">{o.customer_name || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{o.machine_name || "—"}</td>
                      <td className="px-4 py-3">{fmt(o.quantity)} {o.unit || ""}</td>
                      <td className="px-4 py-3">{fmtDate(o.planned_date)}</td>
                      <td className="px-4 py-3"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(o.status)}`}>{o.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      )}

    </div>
  );
}

/* ============================== DASHBOARD ============================== */
const KPI_COLOR = {
  emerald: "bg-emerald-50 text-emerald-600", blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600", rose: "bg-rose-50 text-rose-600",
};

/* Icon máy công nghiệp (SVG tự vẽ) */
const MachineBlow = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <ellipse cx="12" cy="4.5" rx="3" ry="2.2" />
    <path d="M9.2 5.2 C 9 9, 9.8 11, 10 13" />
    <path d="M14.8 5.2 C 15 9, 14.2 11, 14 13" />
    <rect x="4.5" y="13" width="15" height="7" rx="1.5" />
    <path d="M7.5 16.5 h3.5" />
    <circle cx="16" cy="16.8" r="1.1" />
    <path d="M3 20.5 h18" />
  </svg>
);
const MachineCut = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" />
    <path d="M2 12 h20" />
    <path d="M8 12 V6 h7" />
    <path d="M15 6 v2.6" />
    <path d="M13.6 8.6 h2.8 l-1.4 2.2 z" fill="currentColor" stroke="none" />
    <circle cx="7" cy="16.7" r="1.1" />
    <circle cx="17" cy="16.7" r="1.1" />
  </svg>
);
const machineIconOf = (m) => {
  const s = `${m.factory || ""} ${m.name || ""} ${m.machine_type || ""}`;
  if (/c[ắa]t/i.test(s)) return MachineCut;
  return MachineBlow; // thổi / HD / mặc định
};
const workshopRank = (f) => /th[ổô]i/i.test(f || "") ? 0 : /c[ắa]t/i.test(f || "") ? 1 : 2;

function Dashboard({ onNav, onOpenOrder, onOpenProductionOrder }) {
  const { fpermSecret } = usePerm();
  const showMoney = fpermSecret("deliveries", "amounts") !== "hidden";
  const [data, setData] = useState(null);
  useEffect(() => { getDashboard().then(setData).catch((e) => console.error("Dashboard lỗi:", e.message)); }, []);
  if (!data) return <div className="text-slate-400 text-sm py-10">Đang tải số liệu…</div>;

  const { kpi, machines, in_progress, due_soon, status_breakdown, overdue_payments = [], finance } = data;
  const kpis = [
    { label: "Đơn hàng đang mở", value: kpi.open_orders, icon: ShoppingCart, color: "blue", nav: "orders" },
    { label: "Lệnh SX đang chạy", value: kpi.po_active, icon: Factory, color: "amber", nav: "production" },
    { label: "Lệnh SX hoàn thành", value: kpi.po_done, icon: CheckCircle2, color: "emerald", nav: "production" },
    { label: "Dòng đơn chờ kế hoạch", value: kpi.demand_pending, icon: ClipboardList, color: "rose", nav: "planning" },
  ];
  const busy = machines.filter((m) => m.current_task).length;

  return (
    <div className="space-y-6">
      <ListHeader title="Tổng quan" />

      {/* KPI — click để mở app liên quan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <button key={k.label} onClick={() => onNav?.(k.nav)}
            className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:border-blue-300 hover:shadow-sm transition group">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${KPI_COLOR[k.color]}`}><k.icon size={20} /></div>
            <div className="text-2xl font-bold text-slate-800">{fmt(k.value)}</div>
            <div className="text-sm text-slate-500 mt-1 group-hover:text-blue-600">{k.label} →</div>
          </button>
        ))}
      </div>

      {/* Kế toán — chỉ admin/quản lý/kế toán (theo quyền field tiền) */}
      {showMoney && finance && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <Database size={16} className="text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-700">Kế toán · Công nợ</h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-slate-100">
            {[
              { label: "Doanh thu (phiếu)", value: finance.revenue, cls: "text-slate-800", sub: `${fmt(finance.note_count)} phiếu` },
              { label: "Đã thu", value: finance.paid, cls: "text-emerald-600" },
              { label: "Còn phải thu (công nợ)", value: finance.debt, cls: "text-rose-600", nav: "deliveries" },
              { label: "Phiếu chưa thu đủ", value: finance.unpaid_count, cls: "text-amber-600", isCount: true, nav: "deliveries" },
            ].map((c) => (
              <button key={c.label} onClick={() => c.nav && onNav?.(c.nav)} disabled={!c.nav}
                className={`px-5 py-4 text-left ${c.nav ? "hover:bg-slate-50" : ""}`}>
                <div className="text-xs text-slate-500 mb-1">{c.label}{c.nav ? " →" : ""}</div>
                <div className={`text-xl font-bold ${c.cls}`}>{fmt(c.value)}{c.isCount ? "" : " đ"}</div>
                {c.sub && <div className="text-[11px] text-slate-400 mt-0.5">{c.sub}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cảnh báo: phiếu đã giao > 30 ngày chưa thanh toán đủ */}
      {showMoney && overdue_payments.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-rose-200 flex items-center gap-2">
            <Activity size={18} className="text-rose-600" />
            <h2 className="text-sm font-semibold text-rose-800">Công nợ quá hạn — {overdue_payments.length} phiếu đã giao trên 30 ngày chưa thanh toán đủ</h2>
          </div>
          <div className="divide-y divide-rose-100">
            {overdue_payments.map((d) => (
              <button key={d.id} onClick={() => onNav?.("deliveries")} className="w-full grid grid-cols-12 gap-2 px-5 py-2.5 items-center text-left hover:bg-rose-100/50 text-sm">
                <span className="col-span-2 font-medium text-rose-700">{d.note_code}</span>
                <span className="col-span-4 text-slate-700 truncate">{d.customer_name || "—"}</span>
                <span className="col-span-2 text-slate-600">{fmtDate(d.delivery_date)}</span>
                <span className="col-span-2 text-right font-semibold text-slate-800">{showMoney ? `${fmt(d.total_amount)} đ` : ""}</span>
                <span className="col-span-2 text-right text-rose-600 font-semibold">Trễ {d.days_overdue} ngày</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lệnh đang sản xuất + tiến độ */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50"><h2 className="text-sm font-semibold text-slate-700">Lệnh đang sản xuất</h2></div>
          <div className="p-5 space-y-4">
            {in_progress.map((o) => {
              const pct = Math.min(100, Math.round((Number(o.produced_qty) / Number(o.quantity)) * 100));
              return (
                <button key={o.id} onClick={() => onOpenProductionOrder?.(o.id)} className="block w-full text-left group">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700 group-hover:text-blue-600 group-hover:underline">{o.order_code} · {o.product_name}</span>
                    <span className="text-slate-400">{fmt(o.produced_qty)}/{fmt(o.quantity)} ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                </button>
              );
            })}
            {!in_progress.length && <div className="text-sm text-slate-400 text-center py-4">Không có lệnh đang sản xuất.</div>}
          </div>
        </div>

        {/* Đơn hàng sắp đến hạn + phân bố trạng thái */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Đơn hàng sắp đến hạn</h2>
              <div className="flex items-center gap-2.5 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />≤2 ngày</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />3–5</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />&gt;5</span>
              </div>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {due_soon.map((o) => {
                  const tone = dueTone(o.due_date);
                  return (
                    <tr key={o.id || o.order_code} onClick={() => onOpenOrder?.(o.id)} className="cursor-pointer hover:bg-slate-50/70">
                      <td className="pl-5 pr-1 py-2.5"><span className={`inline-block w-2.5 h-2.5 rounded-full ${tone.dot}`} title={tone.label} /></td>
                      <td className="px-2 py-2.5 font-medium text-blue-600 hover:underline">{o.order_code}</td>
                      <td className="px-2 py-2.5 text-slate-600 truncate max-w-[140px]">{o.customer_name}</td>
                      <td className={`px-2 py-2.5 font-medium ${tone.text}`}>{fmtDate(o.due_date)}</td>
                      <td className="px-2 py-2.5"><span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${tone.soft}`}>{tone.label}</span></td>
                      <td className="px-5 py-2.5"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(o.status)}`}>{o.status}</span></td>
                    </tr>
                  );
                })}
                {!due_soon.length && <tr><td className="px-5 py-4 text-slate-400" colSpan={6}>Không có đơn hàng mở.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50"><h2 className="text-sm font-semibold text-slate-700">Phân bố trạng thái lệnh SX</h2></div>
            <div className="p-5 flex flex-wrap gap-2">
              {status_breakdown.map((s) => (
                <button key={s.status} onClick={() => onNav?.("production")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium hover:ring-2 hover:ring-blue-200 transition ${statusClass(s.status)}`}>{s.status}: {s.n}</button>
              ))}
              {!status_breakdown.length && <span className="text-sm text-slate-400">Chưa có lệnh sản xuất.</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Trạng thái máy hôm nay */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
          <Cog size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">Trạng thái máy hôm nay</h2>
          <span className="text-xs text-slate-400">· {busy}/{machines.length} máy đang chạy</span>
        </div>
        <div className="p-5 space-y-5">
          {Object.entries(machines.reduce((acc, m) => { const k = m.factory || "Khác"; (acc[k] = acc[k] || []).push(m); return acc; }, {}))
            .sort((a, b) => workshopRank(a[0]) - workshopRank(b[0]))
            .map(([factory, list]) => {
              const Wicon = machineIconOf({ factory });
              const run = list.filter((m) => m.current_task).length;
              return (
                <div key={factory}>
                  <div className="flex items-center gap-2 mb-2.5 pb-1.5 border-b border-dashed border-slate-200">
                    <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center"><Wicon size={16} /></span>
                    <span className="text-sm font-semibold text-slate-700">{factory}</span>
                    <span className="text-xs text-slate-400">· {run}/{list.length} đang chạy</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {list.map((m) => {
                      const t = m.current_task;
                      const MIcon = machineIconOf(m);
                      return (
                        <button key={m.id} onClick={() => t ? onOpenProductionOrder?.(t.production_order_id) : onNav?.("md:machines")}
                          className={`text-left rounded-lg border p-3 hover:shadow-sm transition ${t ? "border-blue-300 bg-blue-50/50 hover:border-blue-400" : "border-slate-200 hover:border-slate-300"}`}>
                          <div className="flex items-start gap-3">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${t ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"}`}>
                              <MIcon size={28} className={t ? "animate-pulse" : ""} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-medium text-slate-800 text-sm truncate">{m.name}</span>
                                <span className={`w-2 h-2 rounded-full shrink-0 ${t ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
                              </div>
                              {t ? (
                                <div className="mt-1 text-xs text-slate-600">{t.order_code} · {t.stage}<div className="text-slate-400 truncate">{t.product}</div></div>
                              ) : <div className="mt-1 text-xs text-slate-400">Trống</div>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

/* =============================== ROOT APP =============================== */
export default function MesApp() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState(true);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Focus ID cho các danh sách (nếu có, để highlight)
  const [detailId, setDetailId] = useState(null);
  const [detailBack, setDetailBack] = useState("/");
  const [productEditId, setProductEditId] = useState(null);
  const [productCopyId, setProductCopyId] = useState(null);
  const [focusOrderId, setFocusOrderId] = useState(null);
  const [prodOrderBack, setProdOrderBack] = useState(null);
  const [focusSalesOrderId, setFocusSalesOrderId] = useState(null);
  const [deliveryOrderId, setDeliveryOrderId] = useState(null);

  // Tab state
  const [planningTab, setPlanningTab] = useState("orders");

  const [lookups, setLookups] = useState(null);
  const [user, setUser] = useState(null);
  const location = useLocation();

  // Load user từ token
  useEffect(() => {
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("mes_token") : "";
    if (!token) {
      setAuthLoading(false);
      return;
    }
    auth.me().then((r) => setUser(r.user)).catch(() => { setToken(""); setUser(null); }).finally(() => setAuthLoading(false));
  }, []);

  const logout = () => { auth.logout().catch(() => { }); setToken(""); setUser(null); navigate("/"); };

  // Nạp dữ liệu lookup (sản phẩm, khách, máy, kho...) sau khi đăng nhập,
  // và làm mới mỗi khi đổi màn để các dropdown luôn có dữ liệu mới nhất.
  useEffect(() => {
    if (user) getLookups().then(setLookups).catch((e) => console.error("Lookups lỗi:", e.message));
  }, [user, location.pathname]);

  // Khi đăng nhập: nếu không có quyền xem Dashboard → vào thẳng màn đầu tiên được phép
  useEffect(() => {
    if (!user || user.is_admin || location.pathname !== "/") return;
    const perms = user.permissions || {};
    if (perms.dashboard?.view === 'ALLOW' || perms.dashboard?.view === true || perms.dashboard?.view?.status === 'ALLOW') return;
    const order = [
      { key: "execution", path: "/execution" }, { key: "production", path: "/production" },
      { key: "planning", path: "/planning" }, { key: "orders", path: "/orders" },
      { key: "deliveries", path: "/deliveries" }, { key: "products", path: "/products" },
      { key: "bom", path: "/bom" }, { key: "process", path: "/process" },
      { key: "inventory", path: "/inventory" }, { key: "qrlabels", path: "/qrlabels" },
      { key: "qrscan", path: "/qrscan" }, { key: "workschedule", path: "/workschedule" },
      { key: "md_customers", path: "/master-data/customers" },
      { key: "md_employees", path: "/master-data/employees" },
      { key: "md_machines", path: "/master-data/machines" },
      { key: "md_shifts", path: "/master-data/shifts" },
      { key: "md_warehouses", path: "/master-data/warehouses" },
      { key: "md_locations", path: "/master-data/locations" },
      { key: "md_roles", path: "/master-data/roles" },
      { key: "masterdata", path: "/master-data/customers" }, // backward compat
    ];
    const first = order.find((k) => perms[k.key]?.view === 'ALLOW' || perms[k.key]?.view === true);
    if (first) navigate(first.path, { replace: true });
  }, [user, location.pathname, navigate]);

  // Điều hướng chéo module
  const goProductDetail = (id, back = "/products") => { setDetailId(id); setDetailBack(back); navigate("/products/detail"); };
  const goProductionOrder = (id) => { setFocusOrderId(id); setProdOrderBack(location.pathname); navigate("/production"); };
  const goSalesOrder = (id) => { setFocusSalesOrderId(id); navigate("/orders"); };
  const goNewDelivery = (id) => { setDeliveryOrderId(id); navigate("/deliveries"); };

  const needLookups = (Comp) =>
    lookups ? <Comp lookups={lookups} /> : <div className="text-slate-400 text-sm py-10">Đang tải dữ liệu…</div>;
  const loadingEl = <div className="text-slate-400 text-sm py-10">Đang tải dữ liệu…</div>;

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Đang tải…</div>;
  if (!user) return <Login onLogin={setUser} />;

  // Wrapper cho MasterDataScreen để lấy `entity` từ URL
  const MasterDataWrapper = () => {
    const { entity } = useParams();
    return lookups ? <MasterDataScreen lookups={lookups} entity={entity} onOpenOrder={goSalesOrder} onOpenProductionOrder={goProductionOrder} /> : loadingEl;
  };

  return (
    <PermProvider user={user}>
      <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-slate-50 font-sans text-slate-900 relative">
        <Sidebar user={user} onLogout={logout} collapsed={sidebarHidden} onToggle={() => setSidebarHidden(!sidebarHidden)} mobileMenuOpen={mobileMenuOpen} onCloseMobile={() => setMobileMenuOpen(false)} />

        <main className="flex-1 flex flex-col relative overflow-hidden">
          {/* Mobile Header */}
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0 z-30 shadow-sm">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileMenuOpen(true)} className="p-1 text-slate-500 hover:bg-slate-100 rounded">
                <Menu size={20} />
              </button>
              <Logo className="h-6" />
            </div>
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
              {(user?.full_name || user?.username || "?").charAt(0).toUpperCase()}
            </div>
          </div>

          <div className="nav-scroll flex-1 overflow-y-auto p-4 md:p-8 relative">
            <Routes>
              <Route path="/" element={<Dashboard onNav={navigate} onOpenOrder={goSalesOrder} onOpenProductionOrder={goProductionOrder} />} />
              <Route path="/products" element={<ProductList
                onCreate={() => { setProductEditId(null); setProductCopyId(null); navigate("/products/form"); }}
                onCopy={(id) => { setProductEditId(null); setProductCopyId(id); navigate("/products/form"); }}
                onOpen={(id) => { setDetailId(id); setDetailBack("/products"); navigate("/products/detail"); }}
              />} />
              <Route path="/products/form" element={lookups ? <ProductForm productId={productEditId} copyId={productCopyId} lookups={lookups}
                onBack={() => { setProductCopyId(null); navigate(productEditId ? "/products/detail" : "/products"); }}
                onSaved={() => { setProductCopyId(null); navigate(productEditId ? "/products/detail" : "/products"); }}
              /> : loadingEl} />
              <Route path="/products/detail" element={lookups ? <ProductDetail id={detailId} onBack={() => navigate(detailBack)}
                onDeleted={() => navigate(detailBack)} onOpenOrder={goSalesOrder} onOpenProductionOrder={goProductionOrder} lookups={lookups}
              /> : loadingEl} />

              <Route path="/planning" element={lookups ? <PlanningModule lookups={lookups} onOpenOrder={goProductionOrder} onOpenProduct={(id) => goProductDetail(id, "/planning")} initialTab={planningTab} onTabChange={setPlanningTab} /> : loadingEl} />
              <Route path="/production" element={lookups ? <ProductionModule lookups={lookups} focusId={focusOrderId} onFocusConsumed={() => setFocusOrderId(null)}
                onExit={prodOrderBack ? () => { const b = prodOrderBack; setProdOrderBack(null); navigate(b); } : null} /> : loadingEl} />
              <Route path="/orderstatus" element={lookups ? <OrderStatusModule lookups={lookups} onOpenOrder={goProductionOrder} /> : loadingEl} />
              <Route path="/execution" element={needLookups(ExecutionModule)} />
              <Route path="/scrap" element={<ScrapModule onOpenOrder={goProductionOrder} />} />
              <Route path="/recycling" element={<RecyclingModule />} />
              <Route path="/production/output" element={lookups ? <OutputReport lookups={lookups} /> : loadingEl} />
              <Route path="/inventory" element={lookups ? <InventoryModule lookups={lookups} onOpenProduct={(id) => goProductDetail(id, "/inventory")} /> : loadingEl} />
              <Route path="/inventory/inbound" element={lookups ? <InboundModule lookups={lookups} /> : loadingEl} />
              <Route path="/inventory/outbound" element={lookups ? <OutboundModule lookups={lookups} /> : loadingEl} />
              <Route path="/inventory/transfer" element={lookups ? <TransferModule lookups={lookups} /> : loadingEl} />
              <Route path="/inventory/adjust" element={lookups ? <AdjustModule lookups={lookups} /> : loadingEl} />
              <Route path="/traceability/lot" element={<TraceabilityLot />} />
              <Route path="/master-data/roles" element={<RolesModule />} />
              <Route path="/master-data/:entity" element={<MasterDataWrapper />} />
              <Route path="/workschedule" element={needLookups(WorkScheduleModule)} />
              <Route path="/qrlabels" element={<QrLabelsModule />} />
              <Route path="/qrscan" element={<QrScanModule />} />
              <Route path="/reports" element={needLookups(ReportsModule)} />
              <Route path="/reports/inventory" element={lookups ? <InventoryReport lookups={lookups} /> : loadingEl} />
              <Route path="/reports/employees" element={<EmployeeReport />} />
              <Route path="/permissions" element={<PermissionsModule />} />
              <Route path="/users" element={needLookups(UsersModule)} />
              <Route path="/bom" element={needLookups(BomModule)} />
              <Route path="/process" element={needLookups(ProcessModule)} />
              <Route path="/orders" element={lookups ? <OrdersModule lookups={lookups} focusId={focusSalesOrderId} onFocusConsumed={() => setFocusSalesOrderId(null)} onCreateDelivery={goNewDelivery} onOpenProductionOrder={goProductionOrder} /> : loadingEl} />
              <Route path="/deliveries" element={lookups ? <DeliveriesModule lookups={lookups} focusOrderId={deliveryOrderId} onFocusConsumed={() => setDeliveryOrderId(null)} /> : loadingEl} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>

      </div>
    </PermProvider>
  );
}
