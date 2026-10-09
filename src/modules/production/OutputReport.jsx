import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Activity, Download, RefreshCcw, TrendingUp, Package, CheckCircle2, AlertTriangle,
  X, User, Users, CalendarDays, Factory, ShoppingCart, Tag, ClipboardList, Layers,
  ChevronRight, AlertCircle,
} from "lucide-react";
import { ListHeader, Section, DataTable, SearchSelect } from "../../components.jsx";
import { production, scrap as scrapApi } from "../../mesApi.js";
import { fmt, fmtDate, statusClass, toast } from "../../ui.js";
import * as XLSX from "xlsx";
import { usePerm } from "../../perm.jsx";

// Giá trị riêng cho mục "Chưa phân đội" trong bộ lọc đội (không trùng tên đội thật nào)
const NO_TEAM = "__no_team__";
// Báo cáo sản lượng chỉ xét sản phẩm đầu ra — bộ lọc không liệt kê NVL / phế liệu
const OUTPUT_TYPES = new Set(["Thành phẩm", "Bán thành phẩm"]);

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

/* ─── KPI card ─── */
function KpiCard({ label, value, sub, icon: Icon, color = "blue" }) {
  const colors = {
    blue:  { bg: "bg-blue-50",    icon: "text-blue-500",    val: "text-blue-700"    },
    green: { bg: "bg-emerald-50", icon: "text-emerald-500", val: "text-emerald-700" },
    amber: { bg: "bg-amber-50",   icon: "text-amber-500",   val: "text-amber-700"   },
    rose:  { bg: "bg-rose-50",    icon: "text-rose-500",    val: "text-rose-700"    },
  };
  const c = colors[color] || colors.blue;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 flex items-start gap-4">
      <div className={`${c.bg} rounded-lg p-3 shrink-0`}><Icon size={22} className={c.icon} /></div>
      <div className="min-w-0">
        <div className="text-sm text-slate-500 font-medium mb-0.5">{label}</div>
        <div className={`text-2xl font-bold ${c.val}`}>{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
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
    const date = (r.start_date || r.planned_date_display || r.planned_date || r.created_at || "").slice(0, 10);
    const inRange = (!from || date >= from) && (!to || date <= to);
    const matchP  = !productFilter || r.product_code === productFilter;
    const teams   = teamsOf(r);
    const matchT  = !teamFilter || (teamFilter === NO_TEAM ? teams.length === 0 : teams.includes(teamFilter));
    return inRange && matchP && matchT;
  });

  const hasFilter = !!(productFilter || teamFilter);

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
    {
      key: "planned_date", label: "Ngày KH", filter: "date", tdClass: "text-slate-500",
      render: (r) => fmtDate(r.planned_date_display || r.planned_date) || "—",
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
      key: "status", label: "Trạng thái", filter: "select", options: ["Chờ duyệt", "Đã lên kế hoạch", "Chờ nguyên vật liệu", "Đang sản xuất", "Hoàn thành", "Đã hủy"],
      render: (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span>,
    },
    {
      key: "assigned_team", label: "Đội SX", filter: "select", tdClass: "text-slate-600",
      render: (r) => r.assigned_team_display || r.assigned_team || "—",
    },
  ];

  const exportExcel = () => {
    const exportData = filtered.map(r => {
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
        "SL kế hoạch":  planned,
        "SL thực tế":   actual,
        "SL còn lại":   remain > 0 ? remain : 0,
        "Vượt mức":     remain < 0 ? -remain : 0,
        "Tỷ lệ (%)":    planned > 0 ? Math.round(actual / planned * 100) : 0,
        "Trạng thái":   r.status,
        "Đội SX":       r.assigned_team_display || r.assigned_team || "",
      };
    });
    const ws  = XLSX.utils.json_to_sheet(exportData);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sản lượng");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob  = new Blob([wbout], { type: "application/octet-stream" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    a.href = url; a.download = `san-luong-${from}-${to}.xlsx`;
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
          {hasFilter && (
            <button onClick={() => { setProductFilter(""); setTeamFilter(""); }}
              className="text-slate-500 hover:text-slate-700 underline underline-offset-2">
              Xóa bộ lọc
            </button>
          )}
        </div>
      </Section>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="SL kế hoạch" value={fmt(totalPlanned)} sub={`${filtered.length} lệnh SX`}        icon={Package}      color="blue"  />
        <KpiCard label="SL thực tế"  value={fmt(totalActual)}  sub={`Đạt ${achieveRate}% kế hoạch`}       icon={TrendingUp}   color="green" />
        <KpiCard label="Còn lại"     value={fmt(totalRemaining)}
          sub={totalOver > 0 ? `Vượt mức +${fmt(totalOver)}` : "Còn phải sản xuất"}
          icon={ClipboardList} color={totalRemaining === 0 ? "green" : "amber"} />
        <KpiCard label="Đang SX"     value={runningCount}       sub={`/ ${filtered.length} lệnh`}          icon={Activity}     color="blue"  />
        <KpiCard label="Hoàn thành"  value={doneCount}          sub={`/ ${filtered.length} lệnh`}          icon={CheckCircle2} color="green" />
        <KpiCard label="Phế phẩm"    value={fmt(totalScrap)}
          sub={`Tỷ lệ ${scrapRate}% · từ Quản lý phế (${scrapSum.by_day?.length || 0} ngày)`}
          icon={AlertTriangle} color={Number(scrapRate) > 5 ? "rose" : "amber"} />
      </div>

      {/* Table */}
      <Section 
        title="Chi tiết sản lượng" 
        actions={<span className="text-sm text-slate-500">{filtered.length} lệnh sản xuất</span>}
        bodyClass="p-4"
      >
          <DataTable
            dense
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            emptyText={loading ? "Đang tải dữ liệu..." : "Không có dữ liệu trong khoảng thời gian này"}
          />
      </Section>

      {/* Detail drawer */}
      {selected && (
        <OrderDetailDrawer order={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
