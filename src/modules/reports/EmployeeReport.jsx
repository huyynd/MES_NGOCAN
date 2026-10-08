import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Users, RefreshCcw, Download, TrendingUp, Package,
  Clock, CalendarDays, User, Layers, Target, Filter,
  X, ChevronLeft, ChevronRight, AlertCircle, BarChart2,
} from "lucide-react";
import { reports } from "../../mesApi.js";
import { fmt, fmtDate, statusClass, toast } from "../../ui.js";
import * as XLSX from "xlsx";
import { usePerm } from "../../perm.jsx";
import { ListHeader, Section } from "../../components.jsx";

/* ── helpers ── */
const today      = () => new Date().toISOString().slice(0, 10);
const monthStart = () =>
  new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const weekStart = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().slice(0, 10);
};
const pct      = (a, b) => (b > 0 ? Math.round((Number(a) / Number(b)) * 100) : 0);
const pctColor = (p) => p >= 100 ? "text-emerald-600" : p >= 80 ? "text-amber-600" : "text-rose-600";
const pctBg    = (p) => p >= 100 ? "bg-emerald-500" : p >= 80 ? "bg-amber-400"    : "bg-rose-400";

/* ── Paginator ── */
function Pager({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const pages = [];
  const delta = 2;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) pages.push(i);
  }
  const shown = [];
  pages.forEach((p, idx) => {
    if (idx > 0 && p - pages[idx - 1] > 1) shown.push("…");
    shown.push(p);
  });
  return (
    <div className="flex items-center justify-center gap-1 pt-3 pb-1">
      <button
        onClick={() => onChange(page - 1)} disabled={page === 1}
        className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
      >‹</button>
      {shown.map((p, i) =>
        p === "…"
          ? <span key={`e${i}`} className="px-1 text-slate-400 text-xs">…</span>
          : <button key={p} onClick={() => onChange(p)}
              className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                p === page ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}>{p}</button>
      )}
      <button
        onClick={() => onChange(page + 1)} disabled={page === totalPages}
        className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
      >›</button>
    </div>
  );
}

/* ── KPI mini card ── */
function KpiCard({ label, value, sub, icon: Icon, color = "blue", extra }) {
  const C = {
    blue:   ["bg-blue-50",    "text-blue-500",    "text-blue-700"    ],
    green:  ["bg-emerald-50", "text-emerald-500", "text-emerald-700" ],
    amber:  ["bg-amber-50",   "text-amber-500",   "text-amber-700"   ],
    rose:   ["bg-rose-50",    "text-rose-500",    "text-rose-700"    ],
    indigo: ["bg-indigo-50",  "text-indigo-500",  "text-indigo-700"  ],
  }[color] || ["bg-blue-50","text-blue-500","text-blue-700"];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
      <div className={`${C[0]} rounded-lg p-2.5 shrink-0`}><Icon size={18} className={C[1]} /></div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium truncate">{label}</p>
        <p className={`text-xl font-bold ${C[2]}`}>{value}</p>
        {sub   && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        {extra && <div className="mt-1.5">{extra}</div>}
      </div>
    </div>
  );
}

/* ── Bullet bar (KH vs TT) ── */
function BulletBar({ label, planned, actual }) {
  const p = pct(actual, planned);
  const maxV = Math.max(Number(planned), Number(actual), 1);
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-700">{label}</span>
        <span className={`text-xs font-bold ${pctColor(p)}`}>{p}%</span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-16 text-right shrink-0">KH {fmt(planned)}</span>
          <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-200 rounded-full" style={{ width: `${(Number(planned)/maxV)*100}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-16 text-right shrink-0">TT {fmt(actual)}</span>
          <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pctBg(p)}`} style={{ width: `${(Number(actual)/maxV)*100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Stage bar (horizontal) ── */
function StageBar({ stage, actual, planned, maxActual }) {
  const p   = pct(actual, planned);
  const barW = maxActual > 0 ? Math.round((Number(actual) / maxActual) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-700">{stage}</span>
        <span className={`text-xs font-bold ${pctColor(p)}`}>
          {fmt(actual)} <span className="text-slate-400 font-normal">({p}%)</span>
        </span>
      </div>
      <div className="h-3.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${pctBg(p)}`} style={{ width: `${barW}%` }} />
      </div>
    </div>
  );
}

/* ── Recharts tooltip ── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-slate-700 mb-1.5">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-bold text-slate-800">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Work orders table with pagination ── */
const WO_PER_PAGE = 10;
function WorkOrdersTable({ tasks }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil((tasks?.length || 0) / WO_PER_PAGE);
  const slice = (tasks || []).slice((page - 1) * WO_PER_PAGE, page * WO_PER_PAGE);

  useEffect(() => setPage(1), [tasks]);

  if (!tasks?.length) return (
    <div className="py-8 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
      <BarChart2 size={24} className="text-slate-300" />
      Không có lệnh làm việc
    </div>
  );
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
              <th className="text-left py-2.5 px-3 whitespace-nowrap">Đơn hàng (Khách)</th>
              <th className="text-left py-2.5 px-3 whitespace-nowrap">Mã LSX</th>
              <th className="text-left py-2.5 px-3 whitespace-nowrap">Sản phẩm</th>
              <th className="text-left py-2.5 px-3">Công đoạn</th>
              <th className="text-right py-2.5 px-3" title="Sản lượng kế hoạch">Kế hoạch</th>
              <th className="text-right py-2.5 px-3" title="Sản lượng đã làm">Thực tế</th>
              <th className="text-center py-2.5 px-3 min-w-[100px]">Tiến độ</th>
              <th className="text-left py-2.5 px-3">Ca</th>
              <th className="text-left py-2.5 px-3 whitespace-nowrap">Ngày</th>
              <th className="text-center py-2.5 px-3">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slice.map((t) => {
              const isUrgent = t.priority === 'Cao';
              const actual  = t.status === "Hoàn thành" ? (Number(t.actual_qty) || 0) : (Number(t.actual_qty) || 0);
              const planned = Number(t.quantity) || 0;
              // Đơn gấp: tỷ lệ tính bình thường (planned = po.quantity đã chuẩn hóa từ backend)
              const p       = pct(actual, planned);
              return (
                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-700">{t.sales_order_code || "—"}</div>
                    {t.customer_name && <div className="text-xs text-slate-400 truncate max-w-[120px]" title={t.customer_name}>{t.customer_name}</div>}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-blue-600">
                    {t.order_code}
                    {isUrgent && (
                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-700 uppercase tracking-wide">Gấp</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="font-medium text-slate-700">{t.product_code}</span>
                    <span className="block text-slate-400">{t.product_name}</span>
                    {t.material_type && (
                      <span className={`inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                        t.material_type === 'zin'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {t.material_type === 'zin' ? '✦ Hàng zin' : '⟳ Hàng pha'}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                      {t.stage}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-medium text-slate-600">
                    {isUrgent
                      ? <span className="text-rose-500" title="Đơn gấp — kế hoạch = SL đơn hàng gốc">{fmt(planned)} <span className="text-slate-400">{t.unit}</span></span>
                      : <>{fmt(planned)} <span className="text-slate-400">{t.unit}</span></>
                    }
                  </td>
                  <td className={`py-2.5 px-3 text-right font-bold ${pctColor(p)}`}>{fmt(actual)}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pctBg(p)}`} style={{ width: `${Math.min(p, 100)}%` }} />
                      </div>
                      <span className={`text-xs font-bold ${pctColor(p)} w-8 text-right shrink-0`}>{p}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-500">{t.shift || "—"}</td>
                  <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">{fmtDate(t.planned_date) || "—"}</td>
                  <td className="py-2.5 px-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(t.status)}`}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-100 px-4 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {(page - 1) * WO_PER_PAGE + 1}–{Math.min(page * WO_PER_PAGE, tasks.length)} / {tasks.length} lệnh
        </span>
        <Pager page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </>
  );
}

/* ── Right panel: employee detail ── */
function EmployeeDetail({ workerData, detail, loading, onClose }) {
  const {
    worker, team, planned_qty, actual_qty, scrap_qty,
    tasks_count, orders_count, work_days, work_hours,
    done_count, active_count, paused_count,
  } = workerData;
  const overall = pct(actual_qty, planned_qty);
  const { tasks = [], daily = [], stages = [], scrapDaily = [] } = detail || {};
  const maxStage = Math.max(...stages.map(s => Number(s.actual_qty)), 1);

  const mergedChartData = useMemo(() => {
    const map = {};
    daily.forEach(d => {
      map[d.planned_date] = { ...d, total_scrap: 0, scrap_ratio: 0, _ts: new Date(d.planned_date).getTime() };
    });
    scrapDaily.forEach(s => {
      if (!map[s.date]) {
        map[s.date] = { date_label: s.date_label, actual_qty: 0, planned_qty: 0, total_scrap: 0, scrap_ratio: 0, _ts: new Date(s.date).getTime() };
      }
      map[s.date].total_scrap = Number(s.total_scrap);
    });
    return Object.values(map).sort((a,b) => a._ts - b._ts).map(d => ({
      ...d,
      scrap_ratio: d.actual_qty > 0 ? Number((d.total_scrap / d.actual_qty).toFixed(4)) : 0
    }));
  }, [daily, scrapDaily]);

  return (
    <div className="space-y-4">
      {/* ── Employee banner ── */}
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 rounded-xl p-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-lg shrink-0">
              {worker?.[0]?.toUpperCase() || "?"}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-base truncate">{worker}</p>
              {team && <p className="text-xs opacity-75 truncate">{team}</p>}
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors shrink-0"
            title="Đóng">
            <X size={15} />
          </button>
        </div>
        {/* Quick stats bar */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="bg-white/10 rounded-lg py-2">
            <p className={`text-xl font-bold ${overall >= 100 ? "text-emerald-300" : overall >= 80 ? "text-amber-300" : "text-rose-300"}`}>{overall}%</p>
            <p className="text-xs opacity-75">Tỷ lệ HT</p>
          </div>
          <div className="bg-white/10 rounded-lg py-2">
            <p className="text-xl font-bold">{fmt(actual_qty)}</p>
            <p className="text-xs opacity-75">Thực tế</p>
          </div>
          <div className="bg-white/10 rounded-lg py-2">
            <p className="text-xl font-bold">{fmt(planned_qty)}</p>
            <p className="text-xs opacity-75">Kế hoạch</p>
          </div>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Sản lượng đã làm" value={fmt(actual_qty)} sub="tổng thực tế" icon={Layers} color="indigo" />
        <KpiCard label="Tổng phế" value={scrap_qty > 0 ? fmt(scrap_qty) : "0"} sub="phế phẩm (kg)" icon={AlertCircle} color={scrap_qty > 0 ? "rose" : "green"} />
        <KpiCard label="Phế/kg" value={actual_qty > 0 ? (Number(scrap_qty)/Number(actual_qty)).toFixed(4) : "0.0000"} sub="tỷ lệ" icon={Target} color="amber" />
        <KpiCard label="Tỷ lệ hoàn thành" value={`${overall}%`} sub="KH so với TT" icon={TrendingUp} color="emerald" />
        <KpiCard label="Số lệnh làm việc" value={tasks_count} sub="tổng số lệnh" icon={Package} color="blue" />
        <KpiCard label="Ngày làm việc" value={work_days ?? "—"} sub="ngày có phân công" icon={CalendarDays} color="indigo" />
        <KpiCard label="Giờ làm việc" value={work_hours > 0 ? `${work_hours}h` : "—"} sub="ước tính từ ca" icon={Clock} color="amber" />
        <KpiCard label="Năng suất" value={work_hours > 0 && actual_qty > 0 ? `${(Number(actual_qty)/work_hours).toFixed(1)}/h` : "—"} sub="sản phẩm / giờ" icon={TrendingUp} color="green" />
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 py-12 flex items-center justify-center gap-2 text-slate-400 text-sm">
          <RefreshCcw size={16} className="animate-spin" /> Đang tải biểu đồ…
        </div>
      ) : (
        <>
          {/* ── Charts row ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Bullet KH vs TT */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-sm font-semibold text-slate-700 mb-4">Kế hoạch vs Thực tế</p>
              {stages.length === 0 ? (
                <BulletBar label="Tổng" planned={Number(planned_qty)} actual={Number(actual_qty)} />
              ) : (
                <>
                  <BulletBar label="Tổng cộng" planned={Number(planned_qty)} actual={Number(actual_qty)} />
                  <div className="my-3 border-t border-slate-100" />
                  {stages.map(s => (
                    <BulletBar key={s.stage} label={s.stage} planned={Number(s.planned_qty)} actual={Number(s.actual_qty)} />
                  ))}
                </>
              )}
            </div>

            {/* Stage breakdown */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-sm font-semibold text-slate-700 mb-4">Sản lượng theo công đoạn</p>
              {stages.length === 0
                ? <p className="text-slate-400 text-sm text-center py-6">Không có dữ liệu</p>
                : stages.map(s => (
                    <StageBar key={s.stage} stage={s.stage}
                      actual={Number(s.actual_qty)} planned={Number(s.planned_qty)} maxActual={maxStage} />
                  ))
              }
            </div>
          </div>

          {/* ── Daily output chart ── */}
          {mergedChartData.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
              <p className="text-sm font-semibold text-slate-700 mb-1">Sản lượng theo ngày</p>
              <p className="text-xs text-slate-400 mb-4">{mergedChartData.length} ngày có dữ liệu trong kỳ lọc</p>
              <div style={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={mergedChartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="date_label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="actual_qty" name="Thực tế" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={32} />
                    <Line type="monotone" dataKey="planned_qty" name="Kế hoạch" stroke="#cbd5e1" strokeWidth={2} dot={false} strokeDasharray="5 3" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Daily Scrap chart ── */}
          {mergedChartData.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
              <p className="text-sm font-semibold text-slate-700 mb-1">Phế phẩm theo ngày</p>
              <p className="text-xs text-slate-400 mb-4">{mergedChartData.length} ngày có dữ liệu trong kỳ lọc</p>
              <div style={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={mergedChartData} margin={{ top: 4, right: 12, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="date_label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar yAxisId="left" dataKey="total_scrap" name="Tổng phế (kg)" fill="#f43f5e" radius={[3, 3, 0, 0]} maxBarSize={32} />
                    <Line yAxisId="right" type="monotone" dataKey="scrap_ratio" name="Phế/kg" stroke="#f59e0b" strokeWidth={2} dot={{r:3}} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Today's Work orders ── */}
          {(() => {
            const t = today();
            const todayTasks = tasks.filter(x => x.planned_date && x.planned_date.startsWith(t));
            return (
              <div className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden mb-6">
                <div className="px-5 py-3.5 bg-indigo-50/50 border-b border-indigo-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                      <CalendarDays size={16} />
                    </div>
                    <div>
                      <p className="font-bold text-indigo-900 text-sm">Lệnh làm việc hôm nay ({fmtDate(t)})</p>
                      <p className="text-xs text-indigo-600/70 mt-0.5">{todayTasks.length} lệnh cần thực hiện</p>
                    </div>
                  </div>
                </div>
                {todayTasks.length > 0 ? (
                  <WorkOrdersTable tasks={todayTasks} />
                ) : (
                  <div className="py-8 text-center text-indigo-400 text-sm flex flex-col items-center gap-2 bg-indigo-50/10">
                    <CalendarDays size={24} className="text-indigo-300" />
                    Không có lệnh làm việc hôm nay
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Work orders ── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-800 text-sm">Chi tiết lệnh làm việc (Theo bộ lọc thời gian)</p>
                <p className="text-xs text-slate-400 mt-0.5">{tasks.length} lệnh được phân công</p>
              </div>
            </div>
            <WorkOrdersTable tasks={tasks} />
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   Main component
══════════════════════════════════════════════ */
const EMP_PER_PAGE = 12;

export default function EmployeeReport() {
  const { can, isAdmin } = usePerm();
  if (!isAdmin && !can('reports', 'view')) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Bạn không có quyền xem báo cáo nhân viên.</div>
  );
  const [workers, setWorkers]         = useState([]);
  const [loading, setLoading]         = useState(false);
  const [reportTab, setReportTab]     = useState("overview"); // 'overview' | 'detail'
  const [selected, setSelected]       = useState(null);
  const [detail, setDetail]           = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [empPage, setEmpPage]         = useState(1);

  const isManager = isAdmin || can('reports', 'view_all');

  /* filters — mặc định 1 tháng gần nhất để mở màn là thấy số ngay */
  const [from, setFrom]               = useState(monthStart());
  const [to, setTo]                   = useState(today());
  const [timeRange, setTimeRange]     = useState("month");
  const [teamFilter, setTeamFilter]   = useState("");
  const [orderFilter, setOrderFilter] = useState("");
  const [nameFilter, setNameFilter]   = useState("");

  const handleTimeRangeChange = (val) => {
    setTimeRange(val);
    if (val === "week") {
      setFrom(weekStart());
      setTo(today());
    } else if (val === "month") {
      setFrom(monthStart());
      setTo(today());
    }
  };

  const filterParams = { fromDate: from, toDate: to, team: teamFilter, orderCode: orderFilter };

  /* load worker list */
  const loadWorkers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await reports.employees(filterParams);
      setWorkers(Array.isArray(data) ? data : []);
      setEmpPage(1);
    } catch (e) {
      toast.error("Lỗi tải dữ liệu nhân viên: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [from, to, teamFilter, orderFilter]);

  useEffect(() => { loadWorkers(); }, [loadWorkers]);

  /* load detail */
  const loadDetail = useCallback(async (workerName) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await reports.employeeTasks(workerName, filterParams);
      setDetail(data);
    } catch (e) {
      toast.error("Lỗi tải chi tiết: " + e.message);
    } finally {
      setDetailLoading(false);
    }
  }, [from, to, teamFilter]);

  const handleSelectWorker = (w) => {
    if (selected?.worker === w.worker) { setSelected(null); setDetail(null); return; }
    setSelected(w);
    loadDetail(w.worker);
  };

  /* filtered + paginated employee list */
  const filteredWorkers = useMemo(() =>
    workers.filter(w => !nameFilter || w.worker.toLowerCase().includes(nameFilter.toLowerCase())),
    [workers, nameFilter]
  );
  const empTotalPages = Math.ceil(filteredWorkers.length / EMP_PER_PAGE);
  const empSlice = filteredWorkers.slice((empPage - 1) * EMP_PER_PAGE, empPage * EMP_PER_PAGE);

  // Vào tab "chi tiết" mà chưa chọn ai → tự chọn nhân viên đầu tiên (đừng để bên phải trống)
  useEffect(() => {
    if (reportTab === "detail" && !selected && filteredWorkers.length > 0) {
      handleSelectWorker(filteredWorkers[0]);
    }
  }, [reportTab, filteredWorkers.length, selected]); // eslint-disable-line

  /* unique option lists */
  const stageOptions = [...new Set(workers.flatMap(w => (w.stages || "").split(", ").filter(Boolean)))];
  const teamOptions  = [...new Set(workers.flatMap(w => (w.team || "").split(", ").filter(Boolean)))];

  /* export */
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const summaryData = workers.map(w => ({
      "Nhân viên":         w.worker,
      "Đội / Nhà máy":    w.team || "",
      "Công đoạn":         w.stages || "",
      "Ca làm việc":       w.shifts || "",
      "Số lệnh":           w.tasks_count,
      "Số đơn hàng":       w.orders_count,
      "Kế hoạch":          Number(w.planned_qty),
      "Thực tế":           Number(w.actual_qty),
      "Tỷ lệ (%)":         pct(w.actual_qty, w.planned_qty),
      "Phế phẩm":          Number(w.scrap_qty),
      "Ngày làm việc":     w.work_days,
      "Giờ làm (ước tính)": w.work_hours,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), "Tổng hợp NV");
    if (detail?.tasks?.length) {
      const taskData = detail.tasks.map(t => ({
        "Đơn hàng":   t.sales_order_code || "",
        "Mã LSX":      t.order_code,
        "Sản phẩm":   t.product_name,
        "Công đoạn":  t.stage,
        "Kế hoạch":   Number(t.quantity),
        "Thực tế":    t.status === "Hoàn thành" ? (Number(t.actual_qty) ?? Number(t.quantity)) : 0,
        "Phế phẩm":   Number(t.scrap_qty),
        "Trạng thái": t.status,
        "Ca":         t.shift || "",
        "Ngày":       fmtDate(t.planned_date) || "",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(taskData), `Chi tiết ${selected?.worker || ""}`);
    }
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hieu-suat-nhan-vien-${from}-${to}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <ListHeader 
        title="Hiệu suất nhân viên sản xuất"
        actions={<>
          <button onClick={loadWorkers} disabled={loading}
            className="btn-ghost flex items-center gap-1.5 text-sm">
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Làm mới
          </button>
          <button onClick={exportExcel} className="btn-primary flex items-center gap-1.5 text-sm">
            <Download size={14} /> Xuất Excel
          </button>
        </>}
      />

      {/* ── Filters ── */}
      <Section title="Bộ lọc báo cáo" defaultOpen={true}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {!isManager ? (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Thời gian</label>
              <select value={timeRange} onChange={e => handleTimeRangeChange(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400/40 bg-white">
                <option value="week">Tuần này</option>
                <option value="month">Tháng này</option>
              </select>
            </div>
          ) : (
            <>
              {[
                { label: "Từ ngày",   type: "date",   value: from,        set: setFrom        },
                { label: "Đến ngày",  type: "date",   value: to,          set: setTo          },
              ].map(({ label, type, value, set }) => (
                <div key={label}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                  <input type={type} value={value} onChange={e => set(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400/40" />
                </div>
              ))}
            </>
          )}
          {isManager && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Đội / Nhà máy</label>
                <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400/40 bg-white">
                  <option value="">Tất cả</option>
                  {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
      </Section>

      {/* ── Chuyển giữa 2 báo cáo ── */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button onClick={() => setReportTab("overview")}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${reportTab === "overview" ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
          <Users size={16} /> Báo cáo chung
        </button>
        <button onClick={() => setReportTab("detail")}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${reportTab === "detail" ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
          <User size={16} /> Báo cáo chi tiết từng nhân viên
        </button>
      </div>

      {/* ── Master-Detail two-column layout ── */}
      <div className="flex gap-4 items-start">

        {/* LEFT — Employee list (chỉ ở tab "chi tiết") */}
        {reportTab === "detail" && (
        <div className="w-80 xl:w-96 shrink-0 sticky top-4 self-start">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* List header */}
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold text-slate-600">
                  Nhân viên ({filteredWorkers.length})
                </span>
                {selected && (
                  <button onClick={() => { setSelected(null); setDetail(null); }}
                    className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                    <X size={11} /> Bỏ chọn
                  </button>
                )}
              </div>
              {/* Search within list */}
              <input value={nameFilter} onChange={e => { setNameFilter(e.target.value); setEmpPage(1); }}
                placeholder="Tìm tên nhân viên…"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400/40" />
            </div>

            {/* Employee rows */}
            <div className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
              {loading ? (
                <div className="py-10 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                  <RefreshCcw size={14} className="animate-spin" /> Đang tải…
                </div>
              ) : empSlice.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-sm">Không có dữ liệu</div>
              ) : (
                empSlice.map((w, idx) => {
                  const p = pct(w.actual_qty, w.planned_qty);
                  const isSelected = selected?.worker === w.worker;
                  const rank = (empPage - 1) * EMP_PER_PAGE + idx + 1;
                  return (
                    <button key={w.worker} onClick={() => handleSelectWorker(w)}
                      className={`w-full text-left px-4 py-3 transition-all hover:bg-slate-50 ${
                        isSelected ? "bg-indigo-50 border-l-4 border-indigo-500" : "border-l-4 border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {/* Avatar */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          isSelected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                        }`}>
                          {rank <= 3 && !isSelected
                            ? ["🥇","🥈","🥉"][rank - 1]
                            : w.worker?.[0]?.toUpperCase() || "?"}
                        </div>
                        {/* Name + team */}
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-semibold truncate ${isSelected ? "text-indigo-700" : "text-slate-800"}`}>
                            {w.worker}
                          </p>
                          <p className="text-xs text-slate-400 truncate">{w.team || w.stages || "—"}</p>
                        </div>
                        {/* % badge */}
                        <span className={`text-xs font-bold shrink-0 ${pctColor(p)}`}>{p}%</span>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pctBg(p)}`} style={{ width: `${Math.min(p, 100)}%` }} />
                        </div>
                        <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap">
                          {fmt(w.actual_qty)} / {fmt(w.planned_qty)}
                        </span>
                      </div>
                      {/* Tags */}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {w.tasks_count > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{w.tasks_count} lệnh</span>
                        )}
                        {w.shifts && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{w.shifts}</span>
                        )}
                        {w.scrap_qty > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-rose-50 text-rose-500">⚠ {fmt(w.scrap_qty)}</span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Pager */}
            <div className="border-t border-slate-100 px-4 pb-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 py-2">
                  {(empPage - 1) * EMP_PER_PAGE + 1}–{Math.min(empPage * EMP_PER_PAGE, filteredWorkers.length)} / {filteredWorkers.length}
                </span>
                <Pager page={empPage} totalPages={empTotalPages} onChange={setEmpPage} />
              </div>
            </div>
          </div>
        </div>
        )}

        {/* RIGHT — Nội dung báo cáo */}
        <div className="flex-1 min-w-0">
          {reportTab === "overview" ? (
            <div className="space-y-6">
              {/* Tổng quan KPI toàn xưởng */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="font-bold text-slate-800 mb-3">Báo cáo chung — hiệu suất toàn xưởng</h2>
                {(() => {
                  const totSL = workers.reduce((s, w) => s + Number(w.actual_qty), 0);
                  const totPhe = workers.reduce((s, w) => s + Number(w.scrap_qty), 0);
                  const totLenh = workers.reduce((s, w) => s + (w.tasks_count || 0), 0);
                  const nSX = workers.filter(w => Number(w.actual_qty) > 0).length;
                  const ratio = totSL > 0 ? (totPhe / totSL) : 0;
                  const tile = (label, val, cls, sub) => (
                    <div className="bg-slate-50 rounded-lg border border-slate-100 px-3 py-2.5">
                      <div className="text-[11px] text-slate-500">{label}</div>
                      <div className={`text-lg font-bold ${cls || "text-slate-800"}`} style={{ fontVariantNumeric: "tabular-nums" }}>{val}</div>
                      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
                    </div>
                  );
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                      {tile("Nhân viên", workers.length, "text-slate-800")}
                      {tile("Lệnh / việc", totLenh)}
                      {tile("Tổng sản lượng", fmt(totSL) + " kg", "text-indigo-600")}
                      {tile("Tổng phế", fmt(totPhe) + " kg", "text-rose-600")}
                      {tile("Phế / 1kg (TB)", ratio.toFixed(3), "text-amber-600")}
                    </div>
                  );
                })()}
              </div>

              {/* 3 tiêu chí — mỗi cột: biểu đồ Top 5 + bảng xếp hạng (đồng hướng) */}
              {workers.length > 0 && (() => {
                const aw = workers.filter(w => Number(w.actual_qty) > 0);
                const shortNm = (n) => (n && n.length > 17) ? n.slice(0, 16) + '…' : n;
                const ratioOf = (w) => Number(w.actual_qty) > 0 ? Number(w.scrap_qty) / Number(w.actual_qty) : 0;
                const bySL = [...aw].sort((a, b) => Number(b.actual_qty) - Number(a.actual_qty));       // cao nhất trước
                const byPhe = [...aw].sort((a, b) => Number(a.scrap_qty) - Number(b.scrap_qty));         // ít phế nhất trước
                const byRatio = [...aw].sort((a, b) => ratioOf(a) - ratioOf(b));                          // tỷ lệ thấp nhất trước

                const Criterion = ({ title, sub, color, rows, valOf, fmtVal }) => {
                  const chartData = rows.slice(0, 5).map(w => ({ name: shortNm(w.worker), full: w.worker, v: valOf(w) }));
                  return (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                      <div className="px-4 py-3 border-b border-slate-100">
                        <h3 className="font-semibold text-slate-700 text-sm">{title}</h3>
                      </div>
                      {/* Biểu đồ Top 5 */}
                      <div style={{ height: 190 }} className="p-2">
                        {chartData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} layout="vertical" margin={{ left: 4, right: 18, top: 6, bottom: 4 }}>
                              <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                              <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                              <YAxis type="category" dataKey="name" width={128} interval={0}
                                tick={({ x, y, payload }) => (
                                  <text x={x} y={y} dy={3} textAnchor="end" fontSize={11} fill="#475569">{payload.value}</text>
                                )} />
                              <Tooltip formatter={(v) => fmtVal(v)} labelFormatter={(l, p) => p?.[0]?.payload?.full || l} />
                              <Bar dataKey="v" fill={color} radius={[0, 3, 3, 0]} maxBarSize={11} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        ) : <div className="h-full flex items-center justify-center text-sm text-slate-400">Không có dữ liệu</div>}
                      </div>
                      {/* Bảng xếp hạng đầy đủ (đồng hướng với biểu đồ) */}
                      <div className="border-t border-slate-100 divide-y divide-slate-50 max-h-72 overflow-y-auto">
                        {rows.map((w, i) => (
                          <div key={w.worker}
                            className={`px-4 py-2 flex items-center justify-between gap-2 ${i === 0 ? "font-semibold" : ""}`}
                            style={i === 0 ? { backgroundColor: color + "16", boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-5 text-center text-sm font-bold shrink-0" style={{ color: i === 0 ? color : "#94a3b8" }}>{i + 1}</span>
                              <span className={`text-sm truncate ${i === 0 ? "text-slate-900" : "text-slate-700"}`}>{w.worker}</span>
                            </div>
                            <span className="text-sm font-semibold shrink-0" style={{ color }}>{fmtVal(valOf(w))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                };

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
                    <Criterion title="Sản lượng" sub="kg thành phẩm — cao nhất dẫn đầu" color="#6366f1"
                      rows={bySL} valOf={(w) => Number(w.actual_qty)} fmtVal={(v) => `${fmt(v)} kg`} />
                    <Criterion title="Ít phế nhất" sub="kg phế — ít nhất được vinh danh" color="#10b981"
                      rows={byPhe} valOf={(w) => Number(w.scrap_qty)} fmtVal={(v) => `${fmt(v)} kg`} />
                    <Criterion title="Phế / 1kg thấp nhất" sub="kg phế / kg TP — ít nhất được vinh danh" color="#f59e0b"
                      rows={byRatio} valOf={(w) => ratioOf(w)} fmtVal={(v) => Number(v).toFixed(3)} />
                  </div>
                );
              })()}
            </div>
          ) : selected ? (
            <EmployeeDetail
              key={selected.worker}
              workerData={selected}
              detail={detail}
              loading={detailLoading}
              onClose={() => { setSelected(null); setDetail(null); }}
            />
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-10 flex flex-col items-center justify-center text-center text-slate-400 min-h-[300px]">
              <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-3">
                <User size={24} className="text-indigo-400" />
              </div>
              <p className="font-semibold text-slate-600 mb-1">Chọn một nhân viên</p>
              <p className="text-sm">Bấm một nhân viên ở danh sách bên trái để xem báo cáo chi tiết cá nhân</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
