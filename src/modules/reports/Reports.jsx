import React, { useState, useEffect } from 'react';
import { PageHeader, ListHeader, Section, Pagination, usePager } from '../../components.jsx';
import { reports } from '../../mesApi.js';
import { Download, Activity, Factory, PieChart as PieChartIcon } from 'lucide-react';
import * as XLSX from 'xlsx';
import { usePerm } from '../../perm.jsx';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, ComposedChart
} from 'recharts';
import { fmt, fmtDate, statusClass, ymd } from '../../ui.js';

const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6'];

export default function ReportsModule() {
  const [tab, setTab] = useState('kpi'); // kpi, detailed, machines
  const { can, isAdmin } = usePerm();
  if (!isAdmin && !can('reports', 'view')) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Bạn không có quyền xem môđun này.</div>
  );
  
  return (
    <div className="space-y-5">
      <ListHeader title="Hệ thống Báo cáo" />
      
      <div className="flex gap-2 border-b border-slate-200">
        <TabButton id="kpi" label="Báo cáo KPI" current={tab} onClick={setTab} icon={PieChartIcon} />
        <TabButton id="detailed" label="Báo cáo Chi tiết" current={tab} onClick={setTab} icon={Factory} />
        <TabButton id="machines" label="Báo cáo Máy móc" current={tab} onClick={setTab} icon={Activity} />
      </div>

      <div>
        {tab === 'kpi' && <KpiReport />}
        {tab === 'detailed' && <DetailedReport />}
        {tab === 'machines' && <MachineReport />}
      </div>
    </div>
  );
}

function TabButton({ id, label, current, onClick, icon: Icon }) {
  const active = current === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

// ==========================================
// 1. KPI Report
// ==========================================
function KpiReport() {
  const [data, setData] = useState(null);
  const [charts, setCharts] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    reports.kpi().then(res => {
      setData(res.kpi);
      setCharts(res.charts);
      setLoading(false);
    });
  }, []);

  if (loading) return <div>Đang tải dữ liệu...</div>;
  if (!data || !charts) return null;

  // Xử lý dữ liệu hiệu suất (D)
  const performanceData = charts.trend.map(t => ({
    date: t.date,
    perf: t.plan_qty > 0 ? ((t.actual_qty / t.plan_qty) * 100).toFixed(1) : 0
  }));

  // F. Tỷ lệ phế phẩm / chất lượng
  // passed = SUM(actual_qty): tổng sản phẩm hoàn thành
  // failed = SUM(scrap_qty) : tổng phế phẩm
  const completedQty = Number(charts.quality.passed) || 0;
  const scrapQty     = Number(charts.quality.failed) || 0;
  const totalQty     = completedQty + scrapQty;

  // Tỷ lệ phế phẩm (%) = scrap / (hoàn thành + scrap)
  const scrapRate = totalQty > 0
    ? ((scrapQty / totalQty) * 100).toFixed(1)
    : '0.0';

  // Tỷ lệ đạt chất lượng (%) = hoàn thành / tổng
  const passRate = totalQty > 0
    ? ((completedQty / totalQty) * 100).toFixed(1)
    : '100.0';

  const qualData = totalQty > 0
    ? [
        { name: 'Đạt',      value: completedQty },
        { name: 'Phế phẩm', value: scrapQty },
      ]
    : [{ name: 'Chưa có dữ liệu', value: 1 }]; // placeholder khi chưa có data

  return (
    <div className="space-y-6">
      {/* 4 thẻ KPI gốc */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard title="Tổng Lệnh Sản Xuất" value={data.total_production_orders} color="blue" />
        <KpiCard title="Lệnh Đang Sản Xuất" value={data.active_production_orders} color="emerald" />
        <KpiCard title="Máy Đang Hoạt Động" value={data.active_machines} color="amber" />
        <KpiCard title="Tổng Số Tồn Kho" value={fmt(data.total_inventory_items)} color="purple" />
      </div>

      {/* Grid 6 Biểu đồ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* A. Kế hoạch vs Thực tế */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-base font-semibold mb-4 text-slate-800">A. Kế hoạch vs Thực tế (7 ngày)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={charts.trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" fontSize={12} tickMargin={10} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Legend />
                <Bar dataKey="actual_qty" name="Thực tế" fill="#3b82f6" radius={[4,4,0,0]} barSize={30} />
                <Line type="monotone" dataKey="plan_qty" name="Kế hoạch" stroke="#f59e0b" strokeWidth={3} dot={{r: 4}} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* B. Tình trạng Lệnh SX */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-base font-semibold mb-4 text-slate-800">B. Tình trạng Lệnh Sản Xuất</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={charts.status} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value">
                  {charts.status.map((e, i) => <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* C. Sản lượng theo sản phẩm */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-base font-semibold mb-4 text-slate-800">C. Top Sản lượng theo Sản phẩm</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.products} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={12} />
                <YAxis dataKey="name" type="category" width={100} fontSize={11} />
                <Tooltip />
                <Bar dataKey="plan_qty" name="Sản lượng" fill="#10b981" radius={[0,4,4,0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* D. Hiệu suất sản xuất */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-base font-semibold mb-4 text-slate-800">D. Hiệu suất sản xuất (%)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" fontSize={12} tickMargin={10} />
                <YAxis fontSize={12} domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="perf" name="% Hoàn thành" stroke="#8b5cf6" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* E. Tình trạng tồn kho */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative">
          <h3 className="text-base font-semibold mb-4 text-slate-800">E. Tình trạng tồn kho</h3>
          {charts.inventoryAlert > 0 && (
             <div className="absolute top-5 right-5 bg-rose-50 text-rose-600 text-xs font-semibold px-2 py-1 rounded-md border border-rose-200">
               ⚠ {charts.inventoryAlert} vật tư dưới định mức
             </div>
          )}
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.inventory}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" name="Số lượng" fill="#6366f1" radius={[4,4,0,0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* F. Tỷ lệ đạt chất lượng / Phế phẩm */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative">
          <h3 className="text-base font-semibold mb-1 text-slate-800">F. Tỷ lệ đạt chất lượng</h3>
          <p className="text-xs text-slate-400 mb-3">Phế phẩm so với sản phẩm hoàn thành</p>
          <div className="flex items-center gap-4">
            {/* Donut chart */}
            <div className="relative" style={{ width: 160, height: 160, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={qualData}
                    cx="50%" cy="50%"
                    innerRadius={52} outerRadius={72}
                    paddingAngle={totalQty > 0 ? 2 : 0}
                    dataKey="value"
                    startAngle={90} endAngle={-270}
                  >
                    {totalQty > 0
                      ? [<Cell key="pass" fill="#10b981" />, <Cell key="fail" fill="#ef4444" />]
                      : [<Cell key="empty" fill="#e2e8f0" />]
                    }
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      `${Number(value).toLocaleString('vi-VN')} sp`,
                      name
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Center label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {totalQty > 0 ? (
                  <>
                    <span className="text-xl font-bold text-slate-800 leading-none">{passRate}%</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">Đạt CL</span>
                  </>
                ) : (
                  <span className="text-xs text-slate-400 text-center leading-tight px-2">Chưa có dữ liệu</span>
                )}
              </div>
            </div>

            {/* Stats bên phải */}
            <div className="flex-1 space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-emerald-800">Hoàn thành</span>
                </div>
                <div className="text-right">
                  <span className="block text-base font-bold text-emerald-700">{completedQty.toLocaleString('vi-VN')}</span>
                  <span className="text-[10px] text-emerald-500">{passRate}%</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-100">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-red-800">Phế phẩm</span>
                </div>
                <div className="text-right">
                  <span className="block text-base font-bold text-red-700">{scrapQty.toLocaleString('vi-VN')}</span>
                  <span className="text-[10px] text-red-500">{scrapRate}%</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-xs text-slate-500">Tổng đã xử lý</span>
                <span className="text-sm font-semibold text-slate-700">{totalQty.toLocaleString('vi-VN')} sp</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

function KpiCard({ title, value, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200'
  };
  return (
    <div className={`p-6 rounded-2xl border ${colors[color]} shadow-sm`}>
      <h3 className="text-sm font-semibold mb-2 opacity-80">{title}</h3>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}

// ==========================================
// 2. Detailed Report
// ==========================================

const STATUS_COLORS_CHART = {
  'Đang sản xuất': '#f59e0b',
  'Chờ duyệt':    '#94a3b8',
  'Đã lên kế hoạch': '#3b82f6',
  'Chờ nguyên vật liệu': '#a855f7',
  'Hoàn thành':   '#10b981',
  'Đã hủy':       '#ef4444',
  'Quá hạn':      '#ef4444',
};

const DONUT_COLORS = ['#f59e0b', '#94a3b8', '#3b82f6', '#10b981', '#ef4444'];

function toDateStr(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return ymd(dt); // giờ VN (toISOString là UTC → lệch 1 ngày)
}

function formatDateVN(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Custom donut center label (SVG label rendered inside Recharts Pie)
function DonutCenterLabel({ cx, cy, total }) {
  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan x={cx} dy="-6" fontSize="22" fontWeight="700" fill="#1e293b">{total}</tspan>
      <tspan x={cx} dy="22" fontSize="11" fill="#94a3b8">Tổng</tspan>
    </text>
  );
}

function DetailedReport() {
  const today = toDateStr(new Date());
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', orderCode: '', productId: '', status: 'Tất cả' });
  const [applied, setApplied]  = useState({ fromDate: '', toDate: '', orderCode: '', productId: '', status: 'Tất cả' });
  const [res, setRes]          = useState(null);
  const [loading, setLoading]  = useState(true);

  const loadData = (f) => {
    setLoading(true);
    const params = {};
    if (f.fromDate) params.fromDate = f.fromDate;
    if (f.toDate)   params.toDate   = f.toDate;
    if (f.orderCode) params.orderCode = f.orderCode;
    if (f.productId) params.productId = f.productId;
    if (f.status && f.status !== 'Tất cả') params.status = f.status;
    reports.detailed(params).then(r => { setRes(r); setLoading(false); });
  };

  useEffect(() => { loadData(applied); }, []);

  const handleFilter = () => { setApplied(filters); loadData(filters); };

  const data     = res?.data     || [];
  const summary  = res?.summary  || {};
  const charts     = res?.charts     || {};
  const products   = res?.products   || [];
  const orderCodes = res?.orderCodes || [];

  // Pagination — use shared usePager hook
  const { slice: paged, Pager } = usePager(data, 10);

  // Bar chart data
  const barData = (charts.byStatus || []).map(s => ({
    name: s.status,
    'Sản lượng (Kg)': Number(s.plan_qty),
  }));

  const lineData = (charts.trend || []).map(t => ({
    date: t.date,
    'Kế hoạch (Kg)': Number(t.plan_qty),
    'Hoàn thành (Kg)': Number(t.done_qty),
  }));

  const donutData  = (charts.statusDist || []).map(s => ({ name: s.name, value: s.value }));
  const donutTotal = donutData.reduce((a, b) => a + b.value, 0);

  const inProductionPct = summary.total_orders > 0 ? ((summary.in_production / summary.total_orders) * 100).toFixed(2) : '0.00';
  const overduePct      = summary.total_orders > 0 ? ((summary.overdue / summary.total_orders) * 100).toFixed(2) : '0.00';

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(data.map(d => ({
      'Mã Lệnh':         d.order_code,
      'Sản phẩm':        d.product_name,
      'Khách hàng':      d.customer_name || 'Khách lẻ',
      'SL Kế hoạch':     d.quantity,
      'SL Hoàn thành':   d.actual_qty,
      'Đơn vị':          d.unit,
      'Trạng thái':      d.status,
      'Ngày KH':         formatDateVN(d.planned_date),
      'Hạn chót':        formatDateVN(d.due_date),
      'Ghi chú':         d.note || '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Chi Tiết Lệnh SX');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'BaoCaoChiTiet_LenhSX.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-5">

      {/* ── Filter bar ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* From date */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Từ ngày</label>
            <input type="date" value={filters.fromDate}
              onChange={e => setFilters({ ...filters, fromDate: e.target.value })}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
          </div>
          {/* To date */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Đến ngày</label>
            <input type="date" value={filters.toDate}
              onChange={e => setFilters({ ...filters, toDate: e.target.value })}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
          </div>
          {/* Order code */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Mã lệnh</label>
            <input 
              list="order-codes-list"
              value={filters.orderCode}
              onChange={e => {
                const val = e.target.value;
                const matching = orderCodes.find(o => o.order_code === val);
                if (matching) {
                  setFilters({ ...filters, orderCode: val, productId: matching.product_id, status: matching.status });
                } else {
                  setFilters({ ...filters, orderCode: val });
                }
              }}
              placeholder="Nhập mã lệnh..."
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
            <datalist id="order-codes-list">
              {orderCodes.map(o => <option key={o.order_code} value={o.order_code} />)}
            </datalist>
          </div>
          {/* Product */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Sản phẩm</label>
            <select value={filters.productId}
              onChange={e => setFilters({ ...filters, productId: e.target.value })}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500">
              <option value="">Chọn sản phẩm</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.product_name}</option>)}
            </select>
          </div>
          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Trạng thái</label>
            <select value={filters.status}
              onChange={e => setFilters({ ...filters, status: e.target.value })}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500">
              {['Tất cả', 'Chờ duyệt', 'Đã lên kế hoạch', 'Chờ nguyên vật liệu', 'Đang sản xuất', 'Hoàn thành', 'Đã hủy'].map(s =>
                <option key={s} value={s}>{s}</option>
              )}
            </select>
          </div>
          {/* Actions */}
          <button onClick={handleFilter}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            Lọc
          </button>
          <button onClick={exportExcel}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition shadow-sm">
            <Download size={15} /> Xuất Excel
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      {loading ? (
        <div className="text-center py-10 text-slate-500 text-sm">Đang tải dữ liệu...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <SummaryCard
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>}
              label="Tổng số lệnh" value={summary.total_orders ?? 0} unit="Lệnh" color="blue"
            />
            <SummaryCard
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>}
              label="Tổng SL kế hoạch" value={fmt(summary.total_plan_qty ?? 0)} unit="Kg" color="emerald"
            />
            <SummaryCard
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>}
              label="Tổng SL hoàn thành" value={fmt(summary.total_done_qty ?? 0)} unit="Kg" color="teal"
            />
            <SummaryCard
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
              label="Lệnh đang sản xuất" value={summary.in_production ?? 0}
              subValue={`(${inProductionPct}%)`} subColor="text-amber-600" color="amber"
            />
            <SummaryCard
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              label="Lệnh quá hạn" value={summary.overdue ?? 0}
              subValue={`(${overduePct}%)`} subColor="text-rose-600" color="red"
            />
          </div>

          {/* ── Charts Row ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Bar: Sản lượng theo trạng thái */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Sản lượng theo trạng thái</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} barSize={32} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} tickFormatter={s => {
                      const m = { 'Đang sản xuất': 'Đang SX', 'Chờ duyệt': 'Chờ duyệt', 'Đã lên kế hoạch': 'KH', 'Chờ nguyên vật liệu': 'Chờ NVL', 'Hoàn thành': 'HT', 'Đã hủy': 'Hủy' };
                      return m[s] || s;
                    }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => [`${Number(v).toLocaleString('vi-VN')} Kg`, 'Sản lượng']} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Sản lượng (Kg)" radius={[4, 4, 0, 0]}>
                      {barData.map((entry, i) => (
                        <Cell key={i} fill={STATUS_COLORS_CHART[entry.name] || '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Line: Sản lượng kế hoạch vs hoàn thành */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Sản lượng kế hoạch vs hoàn thành</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lineData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="Kế hoạch (Kg)" stroke="#93c5fd" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="Hoàn thành (Kg)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Donut: Trạng thái lệnh */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Trạng thái lệnh</h3>
              <div className="flex items-center gap-4 h-52">
                <div className="flex-1 h-full relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData.length ? donutData : [{ name: 'Trống', value: 1 }]}
                        cx="50%" cy="50%" innerRadius={55} outerRadius={78}
                        paddingAngle={2} dataKey="value"
                        labelLine={false}>
                        {(donutData.length ? donutData : [{ name: 'Trống', value: 1 }]).map((_, i) => (
                          <Cell key={i} fill={donutData.length ? (DONUT_COLORS[i % DONUT_COLORS.length]) : '#e2e8f0'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v, n) => [`${v} lệnh`, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  {donutData.length > 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-bold text-slate-800 leading-none">{donutTotal}</span>
                      <span className="text-xs text-slate-400 mt-1">Tổng</span>
                    </div>
                  )}
                </div>
                {/* Legend */}
                <div className="space-y-1.5 text-xs min-w-[110px]">
                  {donutData.map((d, i) => {
                    const pct = donutTotal > 0 ? ((d.value / donutTotal) * 100).toFixed(2) : '0.00';
                    return (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className="text-slate-600 truncate max-w-[72px]">{d.name}</span>
                        <span className="ml-auto text-slate-500 font-medium">{d.value} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── Table ── */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800">Danh sách lệnh sản xuất</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3">Mã Lệnh</th>
                    <th className="px-5 py-3">Sản phẩm</th>
                    <th className="px-5 py-3">Khách hàng</th>
                    <th className="px-5 py-3 text-right">SL Kế hoạch (Kg)</th>
                    <th className="px-5 py-3 text-right">SL Hoàn thành (Kg)</th>
                    <th className="px-5 py-3">Đơn vị</th>
                    <th className="px-5 py-3">Trạng thái</th>
                    <th className="px-5 py-3">Ngày KH</th>
                    <th className="px-5 py-3">Hạn chót</th>
                    <th className="px-5 py-3">Ghi chú</th>
                    <th className="px-5 py-3">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paged.length === 0 ? (
                    <tr><td colSpan="11" className="px-5 py-10 text-center text-slate-400">Không có dữ liệu</td></tr>
                  ) : paged.map(d => {
                    const isOverdue = d.due_date && new Date(d.due_date) < new Date() && !['Hoàn thành', 'Đã hủy'].includes(d.status);
                    return (
                      <tr key={d.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-3 font-medium text-blue-600">{d.order_code}</td>
                        <td className="px-5 py-3 text-slate-700">{d.product_name}</td>
                        <td className="px-5 py-3 text-slate-600">{d.customer_name || '—'}</td>
                        <td className="px-5 py-3 text-right font-medium text-slate-700">{fmt(d.quantity)}</td>
                        <td className="px-5 py-3 text-right font-medium text-slate-700">{fmt(d.actual_qty)}</td>
                        <td className="px-5 py-3 text-slate-500">{d.unit}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(d.status)}`}>
                            {d.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{formatDateVN(d.planned_date)}</td>
                        <td className={`px-5 py-3 font-medium ${isOverdue ? 'text-rose-600' : 'text-slate-600'}`}>
                          {formatDateVN(d.due_date)}
                        </td>
                        <td className="px-5 py-3 text-slate-400 max-w-[120px] truncate">{d.note || '—'}</td>
                        <td className="px-5 py-3">
                          <button className="text-slate-400 hover:text-slate-700 transition" title="Chi tiết">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination — shared component */}
            <div className="px-5 py-3 border-t border-slate-100">
              <Pager />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, unit, subValue, subColor, color }) {
  const bg = {
    blue:    'bg-blue-50',
    emerald: 'bg-emerald-50',
    teal:    'bg-teal-50',
    amber:   'bg-amber-50',
    red:     'bg-rose-50',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${bg[color] || 'bg-slate-50'}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-500 font-medium mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-slate-800 leading-tight">
          {value} <span className="text-sm font-normal text-slate-500">{unit}</span>
        </p>
        {subValue && <p className={`text-xs font-semibold mt-0.5 ${subColor}`}>{subValue}</p>}
      </div>
    </div>
  );
}

// ==========================================
// 3. Machine Report
// ==========================================
function MachineReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    reports.machines().then(res => {
      setData(res);
      setLoading(false);
    });
  }, []);

  if (loading) return <div>Đang tải dữ liệu...</div>;
  if (!data) return null;

  const pieData = data.status_distribution.map(d => ({
    name: d.status,
    value: d.count
  }));

  const predData = data.prediction.map(d => ({
    date: fmtDate(d.date),
    output: parseFloat(d.predicted_output)
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section className="p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Phân Bố Trạng Thái Máy</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} fill="#8884d8" dataKey="value" label>
                  {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section className="p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Dự Đoán Sản Lượng (7 Ngày Tới)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={predData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{fontSize: 12}} />
                <YAxis tick={{fontSize: 12}} />
                <Tooltip />
                <Line type="monotone" dataKey="output" stroke="#3b82f6" strokeWidth={3} dot={{r: 4}} name="Dự đoán (SP)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      <Section className="p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-6">Thống kê hoạt động máy</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 font-medium border-b">
              <tr>
                <th className="p-4">Mã Máy</th>
                <th className="p-4">Tên Máy</th>
                <th className="p-4">Xưởng</th>
                <th className="p-4">Loại máy</th>
                <th className="p-4">Trạng thái</th>
                <th className="p-4 text-right">CS/Giờ</th>
                <th className="p-4 text-right">Task hoàn thành</th>
                <th className="p-4 text-right">SL thực tế (tổng)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.machine_stats.map(m => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="p-4 font-medium">{m.machine_code}</td>
                  <td className="p-4">{m.name}</td>
                  <td className="p-4 text-slate-500">{m.factory}</td>
                  <td className="p-4 text-slate-500">{m.machine_type || '—'}</td>
                  <td className="p-4"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(m.status)}`}>{m.status}</span></td>
                  <td className="p-4 text-right">{fmt(m.capacity_per_hour)} SP/h</td>
                  <td className="p-4 text-right">
                    <span className="font-semibold text-slate-700">{m.tasks_done}</span>
                    <span className="text-slate-400">/{m.tasks_total}</span>
                  </td>
                  <td className="p-4 text-right font-semibold text-slate-700">{fmt(m.total_actual_qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
