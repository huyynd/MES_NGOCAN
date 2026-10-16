import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Activity, Download, RefreshCcw, TrendingUp, Package, CheckCircle2, AlertTriangle,
  X, User, Users, CalendarDays, Factory, ShoppingCart, Tag, ClipboardList, Layers,
  ChevronRight, AlertCircle,
} from "lucide-react";
import { ListHeader, Section, DataTable, SearchSelect } from "../../components.jsx";
import { production, scrap as scrapApi } from "../../mesApi.js";
import { fmt, fmtDate, statusClass, toast, todayYmd, monthStartYmd } from "../../ui.js";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { usePerm } from "../../perm.jsx";

// Giá trị riêng cho mục "Chưa phân đội" trong bộ lọc đội (không trùng tên đội thật nào)
const NO_TEAM = "__no_team__";
// Báo cáo sản lượng chỉ xét sản phẩm đầu ra — bộ lọc không liệt kê NVL / phế liệu
const OUTPUT_TYPES = new Set(["Thành phẩm", "Bán thành phẩm"]);

// Ngày theo giờ VN (toISOString là giờ UTC → lệch 1 ngày trước 7h sáng / "từ ngày" ra cuối tháng trước)
const today = todayYmd;
const monthStart = monthStartYmd;

// Màu & nhãn ngắn theo trạng thái lệnh — dùng chung cho cả 3 biểu đồ
const STATUS_COLORS = {
  "Chờ duyệt": "#94a3b8",
  "Đã lên kế hoạch": "#3b82f6",
  "Chờ nguyên vật liệu": "#a855f7",
  "Đang sản xuất": "#f59e0b",
  "Hoàn thành": "#10b981",
  "Đã hủy": "#ef4444",
};
const STATUS_SHORT = {
  "Chờ duyệt": "Chờ duyệt", "Đã lên kế hoạch": "KH", "Chờ nguyên vật liệu": "Chờ NVL",
  "Đang sản xuất": "Đang SX", "Hoàn thành": "HT", "Đã hủy": "Hủy",
};
const STATUS_ORDER = Object.keys(STATUS_COLORS);
// Quá hạn = đã qua hạn chót mà chưa Hoàn thành / Đã hủy
const OVERDUE = "__overdue__";
const isOverdue = (r) => {
  const due = (r.due_date || "").slice(0, 10);
  return !!due && due < today() && !["Hoàn thành", "Đã hủy"].includes(r.status);
};
const orderDate = (r) => (r.start_date || r.planned_date_display || r.planned_date || r.created_at || "").slice(0, 10);

/* ─── KPI card: nhãn + icon nhỏ một hàng, số lớn, chú thích 1 dòng; bấm để lọc bảng chi tiết ─── */
function KpiCard({ label, value, sub, icon: Icon, color = "blue", onClick, active }) {
  const colors = {
    blue:  { bg: "bg-blue-50",    icon: "text-blue-500",    val: "text-blue-700",    bar: "bg-blue-500",    ring: "ring-blue-500 border-blue-300"       },
    green: { bg: "bg-emerald-50", icon: "text-emerald-500", val: "text-emerald-700", bar: "bg-emerald-500", ring: "ring-emerald-500 border-emerald-300" },
    amber: { bg: "bg-amber-50",   icon: "text-amber-500",   val: "text-amber-700",   bar: "bg-amber-500",   ring: "ring-amber-500 border-amber-300"     },
    rose:  { bg: "bg-rose-50",    icon: "text-rose-500",    val: "text-rose-700",    bar: "bg-rose-500",    ring: "ring-rose-500 border-rose-300"       },
  };
  const c = colors[color] || colors.blue;
  return (
    <button type="button" onClick={onClick} title="Bấm để xem danh sách chi tiết"
      className={`relative overflow-hidden rounded-xl border bg-white px-4 pt-4 pb-3.5 text-left transition-all hover:shadow-md hover:-translate-y-0.5
        ${active ? `ring-2 shadow-md ${c.ring}` : "border-slate-200"}`}>
      <div className={`absolute left-0 top-0 h-full w-1 ${c.bar}`} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap truncate">{label}</span>
        <span className={`${c.bg} rounded-md p-1.5 shrink-0`}><Icon size={15} className={c.icon} /></span>
      </div>
      <div className={`mt-2 text-2xl font-bold leading-tight tabular-nums ${c.val}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400 truncate" title={sub}>{sub}</div>}
    </button>
  );
}

/* ─── 3 biểu đồ: SL theo trạng thái · KH vs hoàn thành · trạng thái lệnh (bấm để lọc bảng) ─── */
function OutputCharts({ rows, onPick }) {
  const { byStatus, trend, donut, total } = useMemo(() => {
    const st = new Map();
    const day = new Map();
    rows.forEach(r => {
      const plan = Number(r.quantity) || 0;
      const done = Number(r.produced_qty) || 0;
      const s = st.get(r.status) || { name: r.status, plan: 0, count: 0 };
      s.plan += plan; s.count += 1;
      st.set(r.status, s);
      const d = orderDate(r);
      if (d) {
        const x = day.get(d) || { d, plan: 0, done: 0 };
        x.plan += plan; x.done += done;
        day.set(d, x);
      }
    });
    const rank = (n) => { const i = STATUS_ORDER.indexOf(n); return i < 0 ? 99 : i; };
    const statuses = [...st.values()].sort((a, b) => rank(a.name) - rank(b.name));
    return {
      byStatus: statuses.map(s => ({ name: s.name, "Sản lượng": s.plan })),
      donut: statuses.map(s => ({ name: s.name, value: s.count })),
      total: rows.length,
      trend: [...day.values()].sort((a, b) => a.d.localeCompare(b.d)).map(x => ({
        d: x.d,
        date: `${x.d.slice(8, 10)}/${x.d.slice(5, 7)}`,
        "Kế hoạch": x.plan,
        "Hoàn thành": x.done,
      })),
    };
  }, [rows]);

  const colorOf = (n) => STATUS_COLORS[n] || "#94a3b8";
  const num = (v) => Number(v).toLocaleString("vi-VN");
  const card = "bg-white rounded-xl border border-slate-200 p-4";
  const empty = <div className="h-52 flex items-center justify-center text-sm text-slate-400">Chưa có dữ liệu</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Sản lượng kế hoạch theo trạng thái</h3>
        {byStatus.length === 0 ? empty : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStatus} barSize={32} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} tickFormatter={s => STATUS_SHORT[s] || s} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={num} />
                <Tooltip formatter={(v) => [num(v), "Sản lượng KH"]} />
                <Bar dataKey="Sản lượng" radius={[4, 4, 0, 0]} cursor="pointer"
                  onClick={(e) => e?.name && onPick({ key: "status", value: e.name })}>
                  {byStatus.map((e, i) => <Cell key={i} fill={colorOf(e.name)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Sản lượng kế hoạch vs hoàn thành</h3>
        {trend.length === 0 ? empty : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 4, right: 8, left: -10, bottom: 0 }} style={{ cursor: "pointer" }}
                // recharts 3: onClick cấp biểu đồ KHÔNG còn activePayload — chỉ có activeIndex / activeLabel
                onClick={(s) => {
                  const i = Number(s?.activeIndex ?? s?.activeTooltipIndex);
                  const d = (Number.isInteger(i) ? trend[i]?.d : null) ?? trend.find((t) => t.date === s?.activeLabel)?.d;
                  if (d) onPick({ key: "date", value: d });
                }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={num} />
                <Tooltip formatter={(v, n) => [num(v), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Kế hoạch" stroke="#93c5fd" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="Hoàn thành" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Trạng thái lệnh</h3>
        {donut.length === 0 ? empty : (
          <div className="flex items-center gap-3 h-52">
            <div className="flex-1 h-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} cx="50%" cy="50%" innerRadius={55} outerRadius={78} paddingAngle={2} dataKey="value" cursor="pointer"
                    onClick={(e) => e?.name && onPick({ key: "status", value: e.name })}>
                    {donut.map((e, i) => <Cell key={i} fill={colorOf(e.name)} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} lệnh`, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold text-slate-800 leading-none">{total}</span>
                <span className="text-xs text-slate-400 mt-1">Tổng</span>
              </div>
            </div>
            <div className="space-y-1.5 text-xs min-w-[130px]">
              {donut.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1" title={d.name}
                  onClick={() => onPick({ key: "status", value: d.name })}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorOf(d.name) }} />
                  <span className="text-slate-600 truncate">{STATUS_SHORT[d.name] || d.name}</span>
                  <span className="ml-auto text-slate-500 font-medium">{d.value} ({Math.round(d.value / total * 100)}%)</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Info row inside drawer ─── */
function InfoRow({ icon: Icon, label, value, valueClass = "" }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <div className="mt-0.5 shrink-0 text-slate-400"><Icon size={15} /></div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-400 mb-0.5">{label}</div>
        <div className={`text-sm font-medium text-slate-800 ${valueClass}`}>{value}</div>
      </div>
    </div>
  );
}

/* ─── Detail drawer / slide-over ─── */
function OrderDetailDrawer({ order, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  useEffect(() => {
    if (!order) return;
    setLoadingTasks(true);
    production.getTasks(order.id)
      .then(data => setTasks(Array.isArray(data) ? data : []))
      .catch(() => setTasks([]))
      .finally(() => setLoadingTasks(false));
  }, [order?.id]);

  if (!order) return null;

  const actual   = Number(order.produced_qty) || 0;
  const planned  = Number(order.quantity) || 0;
  const remain   = planned - actual; // >0: còn phải SX; <0: vượt mức
  const pct      = planned > 0 ? Math.round(actual / planned * 100) : 0;
  const pctColor = pct >= 100 ? "text-emerald-600" : pct >= 80 ? "text-amber-600" : "text-rose-600";
  const barColor = pct >= 100 ? "bg-emerald-500" : pct >= 80 ? "bg-amber-400" : "bg-rose-400";

  // Gộp danh sách công nhân từ các phân công
  const workers = [...new Set(
    tasks.map(t => t.assigned_worker).filter(Boolean)
  )];
  const teams = [...new Set(
    tasks.map(t => t.assigned_team).filter(Boolean)
  )];

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-[1px] z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[520px] bg-white shadow-2xl z-50 flex flex-col"
        style={{ animation: "slideInRight 0.22s ease" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white shrink-0">
          <div>
            <div className="text-xs font-medium opacity-80 mb-0.5">Chi tiết lệnh sản xuất</div>
            <div className="text-lg font-bold tracking-wide">{order.order_code}</div>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/20 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Trạng thái + tiến độ */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${statusClass(order.status)}`}>
                {order.status}
              </span>
              <span className={`text-xl font-bold ${pctColor}`}>{pct}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-500 mt-2">
              <span>Thực tế: <span className="font-semibold text-slate-700">{fmt(actual)} {order.unit}</span></span>
              <span>Kế hoạch: <span className="font-semibold text-slate-700">{fmt(planned)} {order.unit}</span></span>
            </div>
            <div className="mt-2 text-xs flex items-center gap-1">
              {remain > 0 ? (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertCircle size={12} /> Còn lại: <span className="font-semibold">{fmt(remain)} {order.unit}</span>
                </span>
              ) : (
                <span className="text-emerald-600 font-medium">
                  ✓ Đã đủ kế hoạch{remain < 0 ? ` (vượt +${fmt(-remain)} ${order.unit})` : ""}
                </span>
              )}
            </div>
          </div>

          {/* Thông tin cơ bản */}
          <div className="bg-white rounded-xl border border-slate-200 px-4 divide-y-0">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-2 pb-1">Thông tin lệnh</div>
            <InfoRow icon={Tag}          label="Sản phẩm"       value={`${order.product_code} · ${order.product_name}`} />
            <InfoRow icon={ShoppingCart} label="Đơn hàng bán"   value={order.sales_order_code || "—"} />
            <InfoRow icon={User}         label="Khách hàng"      value={order.customer_name || "—"} />
            <InfoRow icon={CalendarDays} label="Ngày kế hoạch"   value={fmtDate(order.planned_date_display || order.planned_date) || "—"} />
            <InfoRow icon={CalendarDays} label="Deadline giao"   value={fmtDate(order.due_date) || "—"} />
            <InfoRow icon={Factory}      label="Máy sản xuất"    value={order.machine_name_display || order.machine_name || "—"} />
            <InfoRow icon={Layers}       label="Ca sản xuất"     value={order.shift_display || order.shift || "—"} />
          </div>

          {/* Nhân sự */}
          <div className="bg-white rounded-xl border border-slate-200 px-4">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-2 pb-1">Nhân sự thực hiện</div>
            <InfoRow icon={Users} label="Đội sản xuất"  value={teams.length > 0 ? teams.join(", ") : (order.assigned_team_display || order.assigned_team || "—")} />
            <InfoRow icon={User}  label="Công nhân"     value={workers.length > 0 ? workers.join(", ") : (order.assigned_worker || "—")} />
          </div>

          {/* Phân công chi tiết */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Phân công ({tasks.length} lô)
              </span>
              {loadingTasks && <RefreshCcw size={13} className="animate-spin text-slate-400" />}
            </div>
            {tasks.length === 0 && !loadingTasks ? (
              <div className="px-4 py-4 text-sm text-slate-400 text-center">Chưa có phân công</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {tasks.map((t, i) => {
                  const tActual  = (t.actual_qty != null && t.actual_qty !== "") ? Number(t.actual_qty) : (Number(t.quantity) || 0);
                  const tPlanned = Number(t.quantity) || 0;
                  const tPct     = tPlanned > 0 ? Math.round(tActual / tPlanned * 100) : 0;
                  const tColor   = tPct >= 100 ? "text-emerald-600" : tPct >= 80 ? "text-amber-600" : "text-rose-600";
                  return (
                    <div key={t.id || i} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-400">#{i + 1}</span>
                          <span className="text-sm font-medium text-slate-700">{t.stage}</span>
                          {t.machine_name && (
                            <span className="text-xs text-slate-400">· {t.machine_name}</span>
                          )}
                        </div>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(t.status)}`}>
                          {t.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                        <span>KH: <b className="text-slate-700">{fmt(tPlanned)}</b></span>
                        <span>TT: <b className={tColor}>{fmt(tActual)} ({tPct}%)</b></span>
                        {tPlanned - tActual > 0
                          ? <span className="text-amber-600">Còn: <b>{fmt(tPlanned - tActual)}</b></span>
                          : tActual > tPlanned && <span className="text-emerald-600">Vượt: <b>+{fmt(tActual - tPlanned)}</b></span>}
                        {t.planned_date && <span className="flex items-center gap-1"><CalendarDays size={11} />{fmtDate(t.planned_date)}</span>}
                        {t.assigned_team && <span className="flex items-center gap-1"><Users size={11} />{t.assigned_team}</span>}
                        {t.assigned_worker && <span className="flex items-center gap-1"><User size={11} />{t.assigned_worker}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ghi chú */}
          {order.note && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <div className="text-xs font-semibold text-amber-600 mb-1">Ghi chú</div>
              <div className="text-sm text-amber-800">{order.note}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 shrink-0">
          <div className="text-xs text-slate-400 text-center">
            Lệnh tạo: {fmtDate(order.created_at) || "—"} &nbsp;·&nbsp; {order.task_done || 0}/{order.task_count || 0} công đoạn hoàn thành
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}

/* ─── Main component ─── */
export default function OutputReport({ lookups }) {
  const { can, isAdmin } = usePerm();
  if (!isAdmin && !can('prod_output', 'view') && !can('production', 'view')) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Bạn không có quyền xem báo cáo sản xuất.</div>
  );
  const [rows, setRows]               = useState([]);
  const [loading, setLoading]         = useState(false);
  const [from, setFrom]               = useState(monthStart());
  const [to, setTo]                   = useState(today());
  const [productFilter, setProductFilter] = useState("");
  const [teamFilter, setTeamFilter]   = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // "" | tên trạng thái | OVERDUE
  const [showCustomer, setShowCustomer] = useState(false);
  // Góc nhìn của bảng chi tiết: { key: all|actual|remain|running|done|overdue|scrap } hoặc { key: status|date, value }
  const [view, setView] = useState({ key: "all" });
  const [selected, setSelected]       = useState(null); // order được chọn để xem chi tiết
  // Phế KHÔNG ghi theo lệnh — lấy từ module Quản lý phế, gộp theo ngày trong khoảng lọc.
  const [scrapSum, setScrapSum]       = useState({ total_scrap: 0, total_finished: 0, by_day: [] });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await production.list({ status: "", page_size: 500 });
      setRows(Array.isArray(data) ? data : data?.data || []);
    } catch (e) {
      toast.error("Lỗi tải sản lượng: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Nạp tổng phế theo khoảng ngày đang lọc (nguồn: Quản lý phế)
  useEffect(() => {
    if (!from || !to) return;
    let alive = true;
    scrapApi.summary(from, to)
      .then((d) => { if (alive) setScrapSum(d || { total_scrap: 0, total_finished: 0, by_day: [] }); })
      .catch(() => { if (alive) setScrapSum({ total_scrap: 0, total_finished: 0, by_day: [] }); });
    return () => { alive = false; };
  }, [from, to]);

  // Một lệnh có thể gắn nhiều đội ("Nhà máy cắt, Nhà máy thổi") → tách thành danh sách
  const teamsOf = (r) => String(r.assigned_team_display || r.assigned_team || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  // Danh sách chọn lấy từ chính dữ liệu đang có → không bao giờ chọn ra kết quả rỗng.
  // Chỉ Thành phẩm / Bán thành phẩm (bỏ NVL, phế liệu) vì báo cáo sản lượng chỉ quan tâm đầu ra.
  const productOptions = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      if (!r.product_code || m.has(r.product_code)) return;
      if (!OUTPUT_TYPES.has(r.product_type)) return;
      m.set(r.product_code, r.product_name || "");
    });
    return [...m].map(([code, name]) => ({ value: code, label: `${code} · ${name}` }))
      .sort((a, b) => a.value.localeCompare(b.value, "vi"));
  }, [rows]);

  const teamOptions = useMemo(() => {
    const s = new Set();
    rows.forEach(r => teamsOf(r).forEach(t => s.add(t)));
    return [...s].sort((a, b) => a.localeCompare(b, "vi"));
  }, [rows]);

  const hasNoTeam = useMemo(() => rows.some(r => teamsOf(r).length === 0), [rows]);

  // Filter
  const filtered = rows.filter(r => {
    const date = orderDate(r);
    const inRange = (!from || date >= from) && (!to || date <= to);
    const matchP  = !productFilter || r.product_code === productFilter;
    const teams   = teamsOf(r);
    const matchT  = !teamFilter || (teamFilter === NO_TEAM ? teams.length === 0 : teams.includes(teamFilter));
    const matchS  = !statusFilter || (statusFilter === OVERDUE ? isOverdue(r) : r.status === statusFilter);
    return inRange && matchP && matchT && matchS;
  });

  const hasFilter = !!(productFilter || teamFilter || statusFilter);
  const overdueCount = filtered.filter(isOverdue).length;

  // KPI
  const totalPlanned = filtered.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const totalActual  = filtered.reduce((s, r) => s + (Number(r.produced_qty) || 0), 0);
  // Phế lấy từ Quản lý phế (gộp theo ngày trong khoảng lọc), KHÔNG lấy theo lệnh sản xuất.
  const totalScrap    = Number(scrapSum.total_scrap) || 0;
  const scrapFinished = Number(scrapSum.total_finished) || 0;
  const doneCount    = filtered.filter(r => r.status === "Hoàn thành").length;
  const runningCount = filtered.filter(r => r.status === "Đang sản xuất").length;
  const achieveRate  = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
  const scrapRate    = (scrapFinished + totalScrap) > 0
    ? ((totalScrap / (scrapFinished + totalScrap)) * 100).toFixed(1) : "0.0";
  // Còn phải sản xuất (gộp toàn bộ lệnh đang lọc) và phần vượt mức
  const totalRemaining = Math.max(0, totalPlanned - totalActual);
  const totalOver      = Math.max(0, totalActual - totalPlanned);

  // ── Danh sách chi tiết theo "góc nhìn" người dùng bấm (thẻ KPI / biểu đồ) ──
  const VIEWS = {
    all:     { label: "Tất cả lệnh",                     test: () => true },
    actual:  { label: "Lệnh đã có sản lượng thực tế",     test: r => (Number(r.produced_qty) || 0) > 0 },
    remain:  { label: "Lệnh còn phải sản xuất",           test: r => (Number(r.quantity) || 0) > (Number(r.produced_qty) || 0) && r.status !== "Đã hủy" },
    running: { label: "Lệnh đang sản xuất",               test: r => r.status === "Đang sản xuất" },
    done:    { label: "Lệnh hoàn thành",                  test: r => r.status === "Hoàn thành" },
    overdue: { label: "Lệnh quá hạn",                     test: isOverdue },
    scrap:   { label: "Phế phẩm theo ngày (Quản lý phế)", test: () => false },
  };
  const viewLabel = view.key === "status" ? `Trạng thái: ${view.value}`
    : view.key === "date" ? `Ngày ${fmtDate(view.value)}`
    : VIEWS[view.key].label;
  const viewRows = filtered.filter(r =>
    view.key === "status" ? r.status === view.value
    : view.key === "date" ? orderDate(r) === view.value
    : VIEWS[view.key].test(r));
  const scrapRows = (scrapSum.by_day || []).map(d => ({
    ...d, rate: (d.scrap_qty + d.finished_qty) > 0 ? d.scrap_qty / (d.scrap_qty + d.finished_qty) * 100 : 0,
  }));
  const isScrap = view.key === "scrap";
  // Bấm lại thẻ đang chọn → quay về "Tất cả"
  const pick = (v) => setView(cur => (cur.key === v.key && cur.value === v.value) ? { key: "all" } : v);
  const cardProps = (key) => ({ onClick: () => pick({ key }), active: view.key === key });

  const scrapColumns = [
    { key: "date", label: "Ngày", render: (r) => fmtDate(r.date) },
    { key: "finished_qty", label: "SL thành phẩm", align: "right", render: (r) => fmt(r.finished_qty) },
    { key: "scrap_qty", label: "SL phế", align: "right", render: (r) => <span className="font-semibold text-rose-600">{fmt(r.scrap_qty)}</span> },
    { key: "rate", label: "Tỷ lệ phế", align: "right", render: (r) => `${r.rate.toFixed(1)}%` },
  ];

  const columns = [
    {
      key: "order_code", label: "Mã lệnh SX", filter: "text",
      render: (r) => (
        <button
          className="font-semibold text-blue-600 hover:text-blue-800 hover:underline text-left flex items-center gap-1 transition-colors"
          onClick={() => setSelected(r)}
        >
          {r.order_code}
          <ChevronRight size={13} className="opacity-50" />
        </button>
      ),
    },
    {
      key: "product_code", label: "Mã SP", filter: "text", tdClass: "text-slate-600",
      render: (r) => <span>{r.product_code}<span className="block text-xs text-slate-400">{r.product_name}</span></span>,
    },
    ...(showCustomer ? [{
      key: "customer_name", label: "Khách hàng", filter: "text", tdClass: "text-slate-600",
      render: (r) => r.customer_name || "—",
    }] : []),
    {
      key: "planned_date", label: "Ngày KH", filter: "date", tdClass: "text-slate-500",
      render: (r) => fmtDate(r.planned_date_display || r.planned_date) || "—",
    },
    {
      key: "due_date", label: "Hạn chót", filter: "date",
      render: (r) => isOverdue(r)
        ? <span className="text-rose-600 font-semibold" title="Đã quá hạn chót">{fmtDate(r.due_date)}</span>
        : <span className="text-slate-500">{fmtDate(r.due_date) || "—"}</span>,
    },
    {
      key: "quantity", label: "KH", align: "right",
      render: (r) => <span className="text-slate-700 font-medium">{fmt(r.quantity)} <span className="text-xs text-slate-400">{r.unit}</span></span>,
    },
    {
      key: "actual_qty", label: "Thực tế", align: "right",
      render: (r) => {
        const actual  = Number(r.produced_qty) || 0;
        const planned = Number(r.quantity) || 0;
        const pct     = planned > 0 ? Math.round(actual / planned * 100) : 0;
        const color   = pct >= 100 ? "text-emerald-600" : pct >= 80 ? "text-amber-600" : "text-rose-600";
        return (
          <span className={`font-bold ${color}`}>
            {fmt(actual)}
            <span className="ml-1 text-xs font-normal">({pct}%)</span>
          </span>
        );
      },
    },
    {
      key: "remaining_qty", label: "Còn lại", align: "right",
      render: (r) => {
        const actual  = Number(r.produced_qty) || 0;
        const planned = Number(r.quantity) || 0;
        const remain  = planned - actual;
        if (remain > 0) return <span className="text-amber-600 font-medium">{fmt(remain)} <span className="text-xs text-slate-400">{r.unit}</span></span>;
        // Đủ hoặc vượt mức → xanh lá
        return remain < 0
          ? <span className="text-emerald-600 font-medium" title="Sản xuất vượt kế hoạch">+{fmt(-remain)} <span className="text-xs font-normal">vượt</span></span>
          : <span className="text-emerald-600 font-medium">0</span>;
      },
    },
    {
      key: "status", label: "Trạng thái", // lọc trạng thái ở thanh Bộ lọc phía trên
      render: (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span>,
    },
    {
      key: "assigned_team", label: "Đội SX", filter: "select", tdClass: "text-slate-600",
      render: (r) => r.assigned_team_display || r.assigned_team || "—",
    },
  ];

  // Xuất đúng danh sách đang hiển thị ở "Chi tiết sản lượng" (theo thẻ / biểu đồ đã bấm)
  const exportExcel = () => {
    const exportData = isScrap ? scrapRows.map(d => ({
      "Ngày":          fmtDate(d.date),
      "SL thành phẩm": d.finished_qty,
      "SL phế":        d.scrap_qty,
      "Tỷ lệ phế (%)": Number(d.rate.toFixed(1)),
    })) : viewRows.map(r => {
      const planned = Number(r.quantity) || 0;
      const actual  = Number(r.produced_qty) || 0;
      const remain  = planned - actual;
      return {
        "Mã lệnh SX":   r.order_code,
        "Mã SP":         r.product_code,
        "Tên sản phẩm": r.product_name,
        "Khách hàng":   r.customer_name || "",
        "Đơn hàng bán": r.sales_order_code || "",
        "Ngày kế hoạch": fmtDate(r.planned_date_display || r.planned_date) || "",
        "Hạn chót":     fmtDate(r.due_date) || "",
        "Quá hạn":      isOverdue(r) ? "Có" : "",
        "SL kế hoạch":  planned,
        "SL thực tế":   actual,
        "SL còn lại":   remain > 0 ? remain : 0,
        "Vượt mức":     remain < 0 ? -remain : 0,
        "Tỷ lệ (%)":    planned > 0 ? Math.round(actual / planned * 100) : 0,
        "Trạng thái":   r.status,
        "Đội SX":       r.assigned_team_display || r.assigned_team || "",
      };
    });
    if (!exportData.length) { toast.error("Danh sách đang trống, không có gì để xuất"); return; }
    // Dòng đầu ghi rõ đang xuất danh sách nào, khoảng ngày nào
    const ws  = XLSX.utils.aoa_to_sheet([[`${viewLabel} · ${fmtDate(from)} – ${fmtDate(to)}`], []]);
    XLSX.utils.sheet_add_json(ws, exportData, { origin: "A3" });
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isScrap ? "Phế phẩm" : "Sản lượng");
    const slug = { all: "tat-ca", actual: "thuc-te", remain: "con-lai", running: "dang-sx", done: "hoan-thanh",
                   overdue: "qua-han", scrap: "phe-pham", status: "trang-thai", date: `ngay-${view.value}` }[view.key];
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob  = new Blob([wbout], { type: "application/octet-stream" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    a.href = url; a.download = `san-luong-${slug}-${from}-${to}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6">
      <ListHeader 
        title="Sản lượng sản xuất" 
        actions={
          <>
            <button onClick={load} disabled={loading} className="btn-ghost flex items-center gap-2">
              <RefreshCcw size={15} className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
            <button onClick={exportExcel} className="btn-primary flex items-center gap-2">
              <Download size={15} /> Xuất Excel
            </button>
          </>
        }
      />

      {/* Filters */}
      <Section title="Bộ lọc báo cáo" defaultOpen={true}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Từ ngày</label>
            <input type="date" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Đến ngày</label>
            <input type="date" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Sản phẩm (TP / BTP)</label>
            <SearchSelect
              value={productFilter}
              onChange={setProductFilter}
              options={[{ value: "", label: `Tất cả sản phẩm (${productOptions.length})` }, ...productOptions]}
              placeholder={`Tất cả sản phẩm (${productOptions.length})`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Đội sản xuất</label>
            <SearchSelect
              value={teamFilter}
              onChange={setTeamFilter}
              options={[
                { value: "", label: `Tất cả đội (${teamOptions.length})` },
                ...teamOptions.map(t => ({ value: t, label: t })),
                ...(hasNoTeam ? [{ value: NO_TEAM, label: "— Chưa phân đội —" }] : []),
              ]}
              placeholder={`Tất cả đội (${teamOptions.length})`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Trạng thái</label>
            <SearchSelect
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "", label: "Tất cả trạng thái" },
                ...STATUS_ORDER.map(s => ({ value: s, label: s })),
                { value: OVERDUE, label: "⚠ Quá hạn" },
              ]}
              placeholder="Tất cả trạng thái"
            />
          </div>
        </div>

        {/* Tóm tắt kết quả lọc + xóa nhanh */}
        <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-slate-100 text-xs">
          <span className="text-slate-500">
            Kết quả: <b className="text-slate-700">{filtered.length}</b> / {rows.length} lệnh SX
          </span>
          {productFilter && (
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">
              {productFilter}
              <button onClick={() => setProductFilter("")} className="hover:text-blue-900" title="Bỏ lọc sản phẩm">
                <X size={11} />
              </button>
            </span>
          )}
          {teamFilter && (
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">
              {teamFilter === NO_TEAM ? "Chưa phân đội" : teamFilter}
              <button onClick={() => setTeamFilter("")} className="hover:text-blue-900" title="Bỏ lọc đội">
                <X size={11} />
              </button>
            </span>
          )}
          {statusFilter && (
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">
              {statusFilter === OVERDUE ? "Quá hạn" : statusFilter}
              <button onClick={() => setStatusFilter("")} className="hover:text-blue-900" title="Bỏ lọc trạng thái">
                <X size={11} />
              </button>
            </span>
          )}
          {hasFilter && (
            <button onClick={() => { setProductFilter(""); setTeamFilter(""); setStatusFilter(""); }}
              className="text-slate-500 hover:text-slate-700 underline underline-offset-2">
              Xóa bộ lọc
            </button>
          )}
        </div>
      </Section>

      {/* KPI Cards */}
      {/* 7 thẻ / 1 hàng chỉ từ 2xl (1536px): ở 1280px mỗi thẻ ~122px → 6/7 nhãn bị cắt. Dưới 2xl: 4 thẻ / hàng */}
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-7 gap-4">
        <KpiCard label="SL kế hoạch" value={fmt(totalPlanned)} sub={`${filtered.length} lệnh SX`}        icon={Package}      color="blue"  {...cardProps("all")} />
        <KpiCard label="SL thực tế"  value={fmt(totalActual)}  sub={`Đạt ${achieveRate}% kế hoạch`}       icon={TrendingUp}   color="green" {...cardProps("actual")} />
        <KpiCard label="Còn lại"     value={fmt(totalRemaining)}
          sub={totalOver > 0 ? `Vượt mức +${fmt(totalOver)}` : "Còn phải sản xuất"}
          icon={ClipboardList} color={totalRemaining === 0 ? "green" : "amber"} {...cardProps("remain")} />
        <KpiCard label="Đang SX"     value={runningCount}       sub={`/ ${filtered.length} lệnh`}          icon={Activity}     color="blue"  {...cardProps("running")} />
        <KpiCard label="Hoàn thành"  value={doneCount}          sub={`/ ${filtered.length} lệnh`}          icon={CheckCircle2} color="green" {...cardProps("done")} />
        <KpiCard label="Quá hạn"     value={overdueCount}
          sub={filtered.length > 0 ? `${Math.round(overdueCount / filtered.length * 100)}% số lệnh` : "Trễ hạn chót"}
          icon={AlertCircle} color={overdueCount > 0 ? "rose" : "green"} {...cardProps("overdue")} />
        <KpiCard label="Phế phẩm"    value={fmt(totalScrap)}
          sub={`Tỷ lệ phế ${scrapRate}%`}
          icon={AlertTriangle} color={Number(scrapRate) > 5 ? "rose" : "amber"} {...cardProps("scrap")} />
      </div>

      <OutputCharts rows={filtered} onPick={pick} />

      {/* Table — nội dung đổi theo thẻ / biểu đồ đã bấm */}
      <Section
        title={
          <span className="flex items-center gap-2">
            Chi tiết sản lượng
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 px-2.5 py-0.5 text-xs font-medium">
              {viewLabel}
              {view.key !== "all" && (
                <span role="button" title="Xem tất cả lệnh" className="hover:text-blue-900"
                  onClick={(e) => { e.stopPropagation(); setView({ key: "all" }); }}>
                  <X size={12} />
                </span>
              )}
            </span>
          </span>
        }
        action={
          <div className="flex items-center gap-4 text-sm text-slate-500">
            {!isScrap && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={showCustomer} onChange={e => setShowCustomer(e.target.checked)} />
                Hiện cột Khách hàng
              </label>
            )}
            <span>{isScrap ? `${scrapRows.length} ngày` : `${viewRows.length} lệnh sản xuất`}</span>
            <button onClick={exportExcel} className="btn-ghost flex items-center gap-1.5 !py-1.5">
              <Download size={14} /> Xuất Excel
            </button>
          </div>
        }
        bodyClass="p-4"
      >
        {isScrap ? (
          <DataTable
            key="scrap"
            dense
            columns={scrapColumns}
            rows={scrapRows}
            rowKey={(r) => r.date}
            emptyText="Không có phiếu ghi phế trong khoảng thời gian này"
          />
        ) : (
          <DataTable
            key="orders"
            dense
            columns={columns}
            rows={viewRows}
            rowKey={(r) => r.id}
            emptyText={loading ? "Đang tải dữ liệu..." : "Không có lệnh nào trong mục này"}
          />
        )}
      </Section>

      {/* Detail drawer */}
      {selected && (
        <OrderDetailDrawer order={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
