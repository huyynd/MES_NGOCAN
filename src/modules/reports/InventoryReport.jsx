import React, { useState, useEffect, useCallback } from "react";
import {
  Warehouse, Download, RefreshCcw, TrendingUp, TrendingDown,
  Package, AlertTriangle, CheckCircle2, BarChart2
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell
} from "recharts";
import { ListHeader, Section } from "../../components.jsx";
import { inventory } from "../../mesApi.js";
import { fmt, fmtDate, toast } from "../../ui.js";
import * as XLSX from "xlsx";
import { usePerm } from "../../perm.jsx";

/* ─── Màu sắc ─────────────────────────────────────────────────── */
const DONUT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#6366f1", "#ec4899", "#14b8a6"];

/* ─── KPI Card ─────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, icon: Icon, color = "blue", trend }) {
  const palette = {
    blue:  { bg: "bg-blue-50",    icon: "text-blue-500",    val: "text-blue-700",    border: "border-blue-100" },
    green: { bg: "bg-emerald-50", icon: "text-emerald-500", val: "text-emerald-700", border: "border-emerald-100" },
    amber: { bg: "bg-amber-50",   icon: "text-amber-500",   val: "text-amber-700",   border: "border-amber-100" },
    rose:  { bg: "bg-rose-50",    icon: "text-rose-500",    val: "text-rose-700",    border: "border-rose-100" },
    violet:{ bg: "bg-violet-50",  icon: "text-violet-500",  val: "text-violet-700",  border: "border-violet-100" },
  };
  const c = palette[color] || palette.blue;
  return (
    <div className={`bg-white rounded-xl border ${c.border} p-5 flex items-start gap-4 shadow-sm`}>
      <div className={`${c.bg} rounded-xl p-3 shrink-0`}>
        <Icon size={22} className={c.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-500 font-medium mb-0.5 uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-bold ${c.val}`}>{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
      </div>
      {trend !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-medium shrink-0 ${trend >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {Math.abs(trend)}%
        </div>
      )}
    </div>
  );
}

/* ─── Chart card wrapper ───────────────────────────────────────── */
function ChartCard({ title, badge, children, className = "" }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
        {badge}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ─── Custom Tooltip ───────────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
      <div className="font-semibold text-slate-700 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-600">{p.name}:</span>
          <span className="font-bold" style={{ color: p.color }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

/* ─── Main InventoryReport ─────────────────────────────────────── */
export default function InventoryReport({ lookups }) {
  const { can, isAdmin } = usePerm();
  if (!isAdmin && !can('rep_inv', 'view') && !can('reports', 'view')) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Bạn không có quyền xem báo cáo kho.</div>
  );
  const [stockData, setStockData]   = useState([]);
  const [txnData, setTxnData]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [productFilter, setProductFilter]     = useState("");
  const [days, setDays]             = useState("30");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tree, txns] = await Promise.all([
        inventory.tree({}),
        inventory.transactions({}),
      ]);
      setStockData(tree || []);
      setTxnData(txns || []);
    } catch (e) {
      toast.error("Lỗi tải báo cáo kho: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Derived data ─────────────────────────────────────────────── */
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(days));

  const recentTxns = txnData.filter(t => new Date(t.created_at) >= cutoff);

  const groupedStock = React.useMemo(() => {
    const prods = new Map();
    for (const r of stockData) {
      if (!prods.has(r.product_id)) {
        prods.set(r.product_id, {
          product_id: r.product_id, product_code: r.product_code, product_name: r.product_name,
          product_type: r.product_type, min_quantity: r.min_quantity, warehouse_limits: r.warehouse_limits || [], 
          unit: r.unit, total: 0, warehouse_totals: {}
        });
      }
      const P = prods.get(r.product_id);
      P.total += Number(r.quantity) || 0;
      if (r.warehouse_id) {
        P.warehouse_totals[r.warehouse_id] = (P.warehouse_totals[r.warehouse_id] || 0) + (Number(r.quantity) || 0);
      }
      if (!P.unit && r.unit) P.unit = r.unit;
    }
    return [...prods.values()];
  }, [stockData]);

  // Filter stock by warehouse
  const filteredStock = groupedStock.filter(p => {
    const matchW = !warehouseFilter; // warehouse filter applied at lot level
    const matchP = !productFilter ||
      (p.product_name || "").toLowerCase().includes(productFilter.toLowerCase()) ||
      (p.product_code || "").toLowerCase().includes(productFilter.toLowerCase());
    return matchP;
  });

  /* ── KPI values ───────────────────────────────────────────────── */
  const totalStock = filteredStock.reduce((s, p) => s + (Number(p.total) || 0), 0);
  const totalIn    = recentTxns.filter(t => t.trx_type === "Nhập").reduce((s, t) => s + Number(t.quantity), 0);
  const totalOut   = recentTxns.filter(t => t.trx_type === "Xuất").reduce((s, t) => s + Number(t.quantity), 0);

  // Low stock items
  const lowStockItems = filteredStock.filter(p => {
    if (!p.warehouse_limits?.length) return false;
    return p.warehouse_limits.some(w => {
      const qty = p.warehouse_totals?.[w.warehouse_id] || 0;
      return w.min_quantity != null && qty < Number(w.min_quantity);
    });
  });

  // Near min (within 120%)
  const nearMinItems = filteredStock.filter(p => {
    if (!p.warehouse_limits?.length) return false;
    return p.warehouse_limits.some(w => {
      const qty = p.warehouse_totals?.[w.warehouse_id] || 0;
      const min = Number(w.min_quantity);
      return w.min_quantity != null && qty >= min && qty < min * 1.2;
    });
  });

  /* ── A. Biến động nhập-xuất-tồn (grouped by day) ─────────────── */
  const trendMap = new Map();
  recentTxns.forEach(t => {
    const d = t.created_at?.slice(0, 10) || "";
    if (!trendMap.has(d)) trendMap.set(d, { date: d, nhap: 0, xuat: 0 });
    const e = trendMap.get(d);
    if (t.trx_type === "Nhập") e.nhap += Number(t.quantity);
    if (t.trx_type === "Xuất") e.xuat += Number(t.quantity);
  });
  const trendData = [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-14).map(d => ({
    ...d, date: d.date.slice(5), // MM-DD
  }));

  /* ── B. Cơ cấu tồn theo loại sản phẩm (donut) ───────────────── */
  const typeMap = new Map();
  typeMap.set("Thành phẩm", 0);
  typeMap.set("Bán thành phẩm", 0);
  typeMap.set("Nguyên vật liệu", 0);
  
  filteredStock.forEach(p => {
    const t = p.product_type || "Khác";
    typeMap.set(t, (typeMap.get(t) || 0) + (Number(p.total) || 0));
  });
  const donutData = [...typeMap.entries()].map(([name, value]) => ({ name, value }));

  /* ── C. Tồn kho theo kho (bar) ──────────────────────────────── */
  const whMap = new Map();
  filteredStock.forEach(p => {
    Object.entries(p.warehouse_totals || {}).forEach(([wid, qty]) => {
      const wh = (lookups?.warehouses || []).find(x => String(x.id) === String(wid));
      const name = wh?.name || `Kho ${wid}`;
      whMap.set(name, (whMap.get(name) || 0) + Number(qty));
    });
  });
  const warehouseBarData = [...whMap.entries()].map(([name, value]) => ({ name, value }));

  /* ── F. Top sản phẩm tồn kho ─────────────────────────────── */
  const topProducts = [...filteredStock]
    .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
    .slice(0, 8)
    .map(p => ({
      code:           p.product_code || '',
      name:           p.product_name || '',
      label:          `${p.product_code} · ${p.product_name}`,
      value:          Number(p.total) || 0,
      unit:           p.unit || '',
      warehouse_totals: p.warehouse_totals || {},
    }));

  // Max value cho thanh bar tương đối
  const topMax = topProducts[0]?.value || 1;

  /* ── Export Excel ────────────────────────────────────────────── */
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Tổng tồn
    const ws1 = XLSX.utils.json_to_sheet(filteredStock.map(p => ({
      "Mã SP": p.product_code, "Tên sản phẩm": p.product_name,
      "Loại": p.product_type, "Tổng tồn": Number(p.total) || 0, "ĐVT": p.unit,
    })));
    XLSX.utils.book_append_sheet(wb, ws1, "Tồn kho");

    // Sheet 2: Giao dịch
    const ws2 = XLSX.utils.json_to_sheet(recentTxns.map(t => ({
      "Thời gian": new Date(t.created_at).toLocaleString("vi-VN"),
      "Loại": t.trx_type, "Mã SP": t.product_code, "Tên SP": t.product_name,
      "Số lượng": t.quantity, "Kho": t.warehouse_name || "", "Ghi chú": t.note || "",
    })));
    XLSX.utils.book_append_sheet(wb, ws2, "Giao dịch kho");

    // Sheet 3: Cảnh báo
    const ws3 = XLSX.utils.json_to_sheet(lowStockItems.map(p => ({
      "Mã SP": p.product_code, "Tên sản phẩm": p.product_name,
      "Tổng tồn": Number(p.total) || 0, "ĐVT": p.unit,
    })));
    XLSX.utils.book_append_sheet(wb, ws3, "Cảnh báo tồn");

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bao-cao-kho-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    toast.success("Đã xuất Excel thành công!");
  };

  /* ── Donut center label ──────────────────────────────────────── */
  const renderDonutCenter = ({ cx, cy }) => (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
      <tspan x={cx} dy="-8" fontSize="20" fontWeight="bold" fill="#1e293b">{filteredStock.length}</tspan>
      <tspan x={cx} dy="22" fontSize="11" fill="#94a3b8">sản phẩm</tspan>
    </text>
  );

  return (
    <div className="space-y-5">
      <ListHeader 
        title="Báo cáo kho" 
        actions={
          <>
            <button onClick={load} disabled={loading} className="btn-ghost flex items-center gap-2 text-sm">
              <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Làm mới
            </button>
            <button onClick={exportExcel} className="btn-primary flex items-center gap-2 text-sm">
              <Download size={14} /> Xuất Excel
            </button>
          </>
        }
      />

      {/* Filter bar */}
      <Section title="Bộ lọc báo cáo" defaultOpen={true}>
        <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Sản phẩm</label>
          <input
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            placeholder="Tìm mã / tên…" value={productFilter}
            onChange={e => setProductFilter(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Khoảng thời gian giao dịch</label>
          <select
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            value={days} onChange={e => setDays(e.target.value)}
          >
            <option value="7">7 ngày qua</option>
            <option value="14">14 ngày qua</option>
            <option value="30">30 ngày qua</option>
            <option value="90">90 ngày qua</option>
          </select>
        </div>
        <div className="text-xs text-slate-400 self-end pb-1.5 ml-auto">
          {loading ? "Đang tải…" : `${filteredStock.length} sản phẩm · ${recentTxns.length} giao dịch`}
        </div>
        </div>
      </Section>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Tổng tồn kho" value={fmt(totalStock)} sub={`${filteredStock.length} sản phẩm`} icon={Warehouse} color="blue" />
        <KpiCard label="Nhập kho" value={fmt(totalIn)} sub={`${days} ngày qua`} icon={TrendingUp} color="green" />
        <KpiCard label="Xuất kho" value={fmt(totalOut)} sub={`${days} ngày qua`} icon={TrendingDown} color="amber" />
        <KpiCard label="Dưới định mức" value={lowStockItems.length} sub="Cần bổ sung ngay" icon={AlertTriangle} color={lowStockItems.length > 0 ? "rose" : "green"} />
        <KpiCard label="Sắp dưới mức" value={nearMinItems.length} sub="Cảnh báo sớm" icon={CheckCircle2} color={nearMinItems.length > 0 ? "amber" : "green"} />
      </div>

      {/* Row 1: Line chart + Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="A. Biến động Nhập – Xuất kho">
          {trendData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-slate-400 text-sm">
              Chưa có giao dịch trong {days} ngày qua
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="nhap" name="Nhập" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="xuat" name="Xuất" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="B. Cơ cấu tồn kho theo loại sản phẩm"
          badge={<span className="text-xs text-slate-400">{donutData.length} loại</span>}>
          {donutData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-slate-400 text-sm">Chưa có dữ liệu</div>
          ) : (
            <div className="h-56 flex items-center gap-4">
              <div className="flex-1 h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData} cx="50%" cy="50%"
                      innerRadius={55} outerRadius={85}
                      paddingAngle={2} dataKey="value"
                      labelLine={false}
                    >
                      {donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="shrink-0 space-y-2 pr-2">
                {donutData.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="text-slate-600 max-w-[90px] truncate">{d.name}</span>
                    <span className="font-semibold text-slate-700 ml-auto">{fmt(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 2: Bar by warehouse + Bar nhap xuat */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="C. Tồn kho theo kho">
          {warehouseBarData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-slate-400 text-sm">
              Chưa có dữ liệu phân theo kho (cần cấu hình vị trí lưu trữ)
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={warehouseBarData} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" name="Tồn kho" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={40}>
                    {warehouseBarData.map((_, i) => (
                      <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="D. Nhập – Xuất theo ngày (cột)">
          {trendData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-slate-400 text-sm">
              Chưa có giao dịch trong {days} ngày qua
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="nhap" name="Nhập" fill="#10b981" radius={[3, 3, 0, 0]} barSize={12} />
                  <Bar dataKey="xuat" name="Xuất" fill="#f87171" radius={[3, 3, 0, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      {/* E. Cảnh báo tồn kho */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-500" />
            <h3 className="font-semibold text-slate-800 text-sm">E. Cảnh báo tồn kho dưới định mức</h3>
          </div>
          {lowStockItems.length > 0 && (
            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">
              {lowStockItems.length} sản phẩm
            </span>
          )}
        </div>
        {lowStockItems.length === 0 && nearMinItems.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-400 text-sm">
            <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-400" />
            Tất cả sản phẩm đang ở mức tồn an toàn
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Mã SP</th>
                <th className="px-4 py-3 text-left">Sản phẩm</th>
                <th className="px-4 py-3 text-left">Loại kho</th>
                <th className="px-4 py-3 text-right">Tồn thực tế</th>
                <th className="px-4 py-3 text-right">Tối thiểu</th>
                <th className="px-4 py-3 text-right">Còn thiếu</th>
                <th className="px-4 py-3 text-left">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...lowStockItems, ...nearMinItems.filter(p => !lowStockItems.includes(p))].map(p => {
                const alertLimits = (p.warehouse_limits || []).filter(w => {
                  const qty = p.warehouse_totals?.[w.warehouse_id] || 0;
                  return w.min_quantity != null && qty < Number(w.min_quantity) * 1.2;
                });
                return alertLimits.map(w => {
                  const qty = p.warehouse_totals?.[w.warehouse_id] || 0;
                  const min = Number(w.min_quantity);
                  const wh = (lookups?.warehouses || []).find(x => x.id === w.warehouse_id);
                  const isLow = qty < min;
                  const deficit = isLow ? (min - qty) : 0;
                  const pct = min > 0 ? Math.round(qty / min * 100) : 100;
                  return (
                    <tr key={`${p.product_id}-${w.warehouse_id}`} className={`hover:bg-slate-50/60 ${isLow ? "bg-rose-50/30" : "bg-amber-50/20"}`}>
                      <td className="px-4 py-3 font-medium text-blue-600">{p.product_code}</td>
                      <td className="px-4 py-3 text-slate-700">{p.product_name}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{wh?.name || `Kho ${w.warehouse_id}`}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">{fmt(qty)}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{fmt(min)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-rose-600">{isLow ? fmt(deficit) : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isLow ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700">
                              🔴 Dưới tối thiểu ({pct}%)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                              🟡 Sắp dưới mức ({pct}%)
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* F. Top sản phẩm tồn kho */}
      <ChartCard title="F. Top sản phẩm tồn kho cao nhất"
        badge={<span className="text-xs text-slate-400">Top {topProducts.length}</span>}>
        {topProducts.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Chưa có dữ liệu</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Mã SP</th>
                  <th className="px-4 py-3 text-left">Tên sản phẩm</th>
                  <th className="px-4 py-3 text-right">Tổng tồn</th>
                  <th className="px-4 py-3 text-left" style={{ minWidth: 180 }}>Tồn theo kho</th>
                  <th className="px-4 py-3 text-left">Tỷ lệ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topProducts.map((p, idx) => {
                  const warehouseEntries = Object.entries(p.warehouse_totals)
                    .map(([wid, qty]) => ({
                      wh: (lookups?.warehouses || []).find(x => String(x.id) === String(wid)),
                      qty: Number(qty) || 0,
                      wid,
                    }))
                    .filter(e => e.qty > 0)
                    .sort((a, b) => b.qty - a.qty);

                  const pct = Math.round((p.value / topMax) * 100);

                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      {/* Mã SP */}
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-600 whitespace-nowrap">
                        {p.code}
                      </td>
                      {/* Tên SP */}
                      <td className="px-4 py-3 text-slate-700 max-w-[180px] truncate" title={p.name}>
                        {p.name}
                      </td>
                      {/* Tổng tồn */}
                      <td className="px-4 py-3 text-right font-bold text-slate-800 whitespace-nowrap">
                        {fmt(p.value)}
                        <span className="ml-1 text-xs font-normal text-slate-400">{p.unit}</span>
                      </td>
                      {/* Tồn theo kho */}
                      <td className="px-4 py-3">
                        {warehouseEntries.length === 0 ? (
                          <span className="text-slate-300 text-xs">Chưa phân kho</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {warehouseEntries.map((e, wi) => (
                              <span key={wi}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                                style={{
                                  background: `${DONUT_COLORS[wi % DONUT_COLORS.length]}18`,
                                  color: DONUT_COLORS[wi % DONUT_COLORS.length],
                                  border: `1px solid ${DONUT_COLORS[wi % DONUT_COLORS.length]}40`,
                                }}
                              >
                                <span className="font-semibold">{e.wh?.name || `Kho ${e.wid.slice(0,6)}…`}</span>
                                <span className="opacity-70">·</span>
                                <span>{fmt(e.qty)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      {/* Thanh tỷ lệ */}
                      <td className="px-4 py-3" style={{ minWidth: 100 }}>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${pct}%`,
                                background: DONUT_COLORS[idx % DONUT_COLORS.length],
                              }}
                            />
                          </div>
                          <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
