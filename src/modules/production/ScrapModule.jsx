import React, { useState, useEffect, useMemo, useCallback } from "react";
import { 
  Users, Calendar, Save, List, Plus, Settings2, Trash2, Edit2, 
  BarChart2, FileText, CheckCircle2, TrendingUp, TrendingDown,
  RefreshCcw, ChevronDown, ChevronRight
} from "lucide-react";
import { PageHeader, DataTable } from "../../components.jsx";
import { scrap } from "../../mesApi.js";
import { inputCls, fmt, toast, todayYmd } from "../../ui.js";
import { usePerm } from "../../perm.jsx";

// ----- STATISTICS COMPONENT -----
function ScrapStatistics({ worker, onOpenOrder }) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState([]);
  const [totals, setTotals] = useState({ total_finished: 0, total_scrap: 0 });
  
  // Expanded rows logic
  const [expandedDate, setExpandedDate] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [dailyDetails, setDailyDetails] = useState([]);

  const loadStats = useCallback(async () => {
    if (!worker) return setStats([]);
    setLoading(true);
    try {
      const today = todayYmd();
      const res = await scrap.stats(worker, today);
      // API mới trả về { rows, totals } — rows cho bảng theo ngày, totals cho KPI summary
      if (res && res.rows) {
        setStats(res.rows);
        setTotals(res.totals || { total_finished: 0, total_scrap: 0 });
      } else {
        // fallback nếu API cũ trả về array
        setStats(Array.isArray(res) ? res : []);
        setTotals({ total_finished: 0, total_scrap: 0 });
      }
      setExpandedDate(null);
    } catch (e) {
      toast.error("Lỗi tải thống kê: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [worker]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Summary KPI tính từ `totals` (do server trả về, tính độc lập không bị lệch ngày)
  const summary = useMemo(() => {
    let wos = 0;
    stats.forEach(r => { wos += Number(r.total_wos) || 0; });
    const finished = Number(totals.total_finished) || 0;
    const scrapTotal = Number(totals.total_scrap) || 0;
    const ratio = finished > 0 ? (scrapTotal / finished * 100).toFixed(2) : 0;
    const kgPerKg = finished > 0 ? (scrapTotal / finished).toFixed(4) : 0;
    return { wos, finished, scrapTotal, ratio, kgPerKg };
  }, [stats, totals]);

  const handleRowClick = async (row) => {
    if (expandedDate === row.date) {
      setExpandedDate(null);
      return;
    }
    setExpandedDate(row.date);
    setDetailsLoading(true);
    try {
      const details = await scrap.dailyDetails(worker, row.date);
      setDailyDetails(details || []);
    } catch (e) {
      toast.error("Lỗi lấy chi tiết: " + e.message);
      setDailyDetails([]);
    } finally {
      setDetailsLoading(false);
    }
  };

  const cols = [
    { 
      key: "expand", 
      label: "", 
      width: 40,
      render: r => (
        <button className="p-1 hover:bg-slate-100 rounded text-slate-500">
          {expandedDate === r.date ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      )
    },
    { key: "date", label: "Ngày", render: r => new Date(r.date).toLocaleDateString("vi-VN") },
    { key: "total_wos", label: "Lệnh hoàn thành", align: "center", render: r => <span className="font-semibold">{r.total_wos}</span> },
    { key: "total_finished", label: "Thành phẩm", align: "right", render: r => fmt(r.total_finished) },
    { key: "total_scrap", label: "Phế phẩm", align: "right", render: r => <span className="text-rose-600 font-semibold">{fmt(r.total_scrap)}</span> },
  ];

  const detailCols = [
    { key: "order_code", label: "Lệnh SX", tdClass: "font-medium text-blue-600" },
    { key: "step_name", label: "Công đoạn" },
    { key: "product_name", label: "Sản phẩm", render: r => `${r.product_code} - ${r.product_name}` },
    { key: "actual_qty", label: "Thực tế", align: "right", render: r => <span className="font-semibold text-emerald-600">{fmt(r.actual_qty)} {r.unit}</span> },
    { key: "product_scrap_qty", label: "Tổng Phế (SP/Ngày)", align: "right", render: r => <span className="font-semibold text-rose-500">{fmt(r.product_scrap_qty)}</span> },
    { key: "ratio", label: "Tỷ lệ Phế / kg", align: "right", render: r => {
      const actual = Number(r.actual_qty) || 0;
      const pScrap = Number(r.product_scrap_qty) || 0;
      return actual > 0 ? (pScrap / actual).toFixed(4) : "0.0000";
    }}
  ];

  if (!worker) {
    return (
      <div className="py-12 text-center bg-white rounded-xl border border-slate-200">
        <Users className="mx-auto h-12 w-12 text-slate-300 mb-3" />
        <p className="text-slate-500">Vui lòng chọn công nhân ở phía trên để xem thống kê</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-sm font-medium mb-1">Tổng lệnh sản xuất</div>
          <div className="text-2xl font-bold text-slate-800">{fmt(summary.wos)} Lệnh</div>
          <div className="text-xs text-slate-400 mt-1">Trong 7 ngày qua</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-sm font-medium mb-1">Tổng thành phẩm</div>
          <div className="text-2xl font-bold text-emerald-600">{fmt(summary.finished)} kg</div>
          <div className="text-xs text-slate-400 mt-1">Trong 7 ngày qua</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-sm font-medium mb-1">Tổng phế phẩm</div>
          <div className="text-2xl font-bold text-rose-600">{fmt(summary.scrapTotal)} kg</div>
          <div className="text-xs text-slate-400 mt-1">Tỷ lệ chung: {summary.ratio}%</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-sm font-medium mb-1">Phế / 1 đơn vị thành phẩm</div>
          <div className="text-2xl font-bold text-amber-600">{summary.kgPerKg}</div>
          <div className="text-xs text-slate-400 mt-1">≈ {(summary.kgPerKg * 1000).toFixed(1)} / 1000 đơn vị TP</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold text-slate-700 flex items-center gap-2">
            <BarChart2 size={18} className="text-blue-500"/> Chi tiết theo ngày
          </div>
          <button onClick={loadStats} className="btn-ghost text-sm flex items-center gap-1.5">
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Cập nhật
          </button>
        </div>
        <div className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                {cols.map((c, i) => (
                  <th key={i} className="px-4 py-3 font-semibold" style={{ textAlign: c.align || 'left', width: c.width }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={cols.length} className="px-4 py-8 text-center text-slate-500">
                    {loading ? "Đang tải dữ liệu..." : "Không có dữ liệu trong 7 ngày qua"}
                  </td>
                </tr>
              ) : (
                stats.map((row) => (
                  <React.Fragment key={row.date}>
                    <tr 
                      className={`hover:bg-slate-50 cursor-pointer transition-colors ${expandedDate === row.date ? 'bg-blue-50/30' : ''}`}
                      onClick={() => handleRowClick(row)}
                    >
                      {cols.map((c, i) => (
                        <td key={i} className={`px-4 py-3 ${c.tdClass || ""}`} style={{ textAlign: c.align || 'left' }}>
                          {c.render ? c.render(row) : row[c.key]}
                        </td>
                      ))}
                    </tr>
                    {expandedDate === row.date && (
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <td colSpan={cols.length} className="p-0">
                          <div className="px-10 py-4 shadow-inner">
                            <div className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                              <List size={14} /> Chi tiết Công đoạn & Lệnh SX ngày {new Date(row.date).toLocaleDateString("vi-VN")}
                            </div>
                            {detailsLoading ? (
                              <div className="text-slate-500 text-sm py-4 animate-pulse">Đang tải chi tiết...</div>
                            ) : dailyDetails.length === 0 ? (
                              <div className="text-slate-500 text-sm py-4">Không có công đoạn nào được ghi nhận.</div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {dailyDetails.map(task => {
                                   const actual = Number(task.actual_qty) || 0;
                                   const pScrap = Number(task.product_scrap_qty) || 0;
                                   const ratio = actual > 0 ? (pScrap / actual).toFixed(4) : "0.0000";
                                   return (
                                      <div key={task.task_id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                                        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                          <div className="font-semibold text-blue-700 flex items-center gap-1.5">
                                            <FileText size={14} className="text-blue-500" />
                                            {onOpenOrder && task.order_id ? (
                                              <button onClick={(e) => { e.stopPropagation(); onOpenOrder(task.order_id); }} className="hover:underline">{task.order_code}</button>
                                            ) : (
                                              task.order_code
                                            )}
                                          </div>
                                          <span className="text-xs font-medium px-2 py-1 bg-slate-200 text-slate-700 rounded-md">{task.step_name}</span>
                                        </div>
                                        <div className="p-4 space-y-3">
                                           <div>
                                             <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Sản phẩm</div>
                                             <div className="text-sm font-medium text-slate-800 line-clamp-1" title={`${task.product_code} - ${task.product_name}`}>
                                               {task.product_code} - {task.product_name}
                                             </div>
                                           </div>
                                           <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                                             <div>
                                                <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Thực tế</div>
                                                <div className="text-sm font-bold text-emerald-600">{fmt(task.actual_qty)} {task.unit}</div>
                                             </div>
                                             <div className="text-right">
                                                <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Tổng Phế/Ngày</div>
                                                <div className="text-sm font-bold text-rose-500">{fmt(task.product_scrap_qty)}</div>
                                             </div>
                                           </div>
                                           <div className="bg-amber-50 rounded-lg p-2.5 flex items-center justify-between mt-1">
                                             <span className="text-xs text-amber-700 font-semibold">Tỷ lệ phế / {task.unit}:</span>
                                             <span className="text-sm font-bold text-amber-600">{ratio}</span>
                                           </div>
                                        </div>
                                      </div>
                                   );
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ScrapForm({ worker, workerId, date, setDate, onOpenOrder, cameFromManage, onBack }) {
  const { user } = usePerm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [wos, setWos] = useState([]);
  const [record, setRecord] = useState(null); // existing record
  const [scrapQty, setScrapQty] = useState("");
  const [note, setNote] = useState("");
  const [recorderName, setRecorderName] = useState("");

  // Load WOs and existing record for selected worker + date
  const loadData = useCallback(async () => {
    if (!worker || !date) {
      setWos([]);
      setRecord(null);
      setScrapQty("");
      return;
    }
    setLoading(true);
    try {
      const [wosData, recordData] = await Promise.all([
        scrap.dailyWos(worker, date),
        scrap.records(worker, date)
      ]);
      setWos(wosData || []);
      setRecord(recordData);
      setNote(recordData?.note || "");
      setRecorderName(recordData?.recorder_name || user?.name || "");
      
      let totalScrap = "";
      if (recordData && recordData.items && recordData.items.length > 0) {
        totalScrap = recordData.items.reduce((s, it) => s + (Number(it.scrap_qty) || 0), 0);
      }
      setScrapQty(totalScrap);
    } catch (e) {
      toast.error("Lỗi tải dữ liệu: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [worker, date]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Group WOs by product for display
  const productGroups = useMemo(() => {
    const groups = {};
    wos.forEach(wo => {
      if (!groups[wo.product_id]) {
        groups[wo.product_id] = {
          product_id: wo.product_id,
          product_code: wo.product_code,
          product_name: wo.product_name,
          unit: wo.unit,
          total_qty: 0,
          wos: []
        };
      }
      groups[wo.product_id].total_qty += Number(wo.total_qty) || 0;
      groups[wo.product_id].wos.push(wo);
    });
    return Object.values(groups);
  }, [wos]);

  const handleSave = async () => {
    if (!worker) return toast.error("Vui lòng chọn công nhân");
    if (!productGroups.length) return toast.error("Không có thành phẩm nào để ghi phế");

    if (!scrapQty || Number(scrapQty) < 0) {
      if (!window.confirm("Số lượng phế = 0 hoặc chưa nhập. Bạn có chắc chắn muốn lưu?")) return;
    }

    setSaving(true);
    try {
      await scrap.save({
        worker_name: worker,
        employee_id: workerId || null,
        record_date: date,
        note,
        scrap_qty: Number(scrapQty) || 0,
        recorder_name: recorderName || worker,
      });
      toast.success("Ghi nhận phế phẩm thành công!");
      await loadData();
      if (cameFromManage && onBack) {
        onBack();
      }
    } catch (e) {
      toast.error("Lỗi khi lưu: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const woCols = [
    { key: "order_code", label: "Lệnh SX", tdClass: "font-medium text-blue-600", render: r => onOpenOrder && r.order_id ? <button onClick={(e) => { e.stopPropagation(); onOpenOrder(r.order_id); }} className="hover:underline">{r.order_code}</button> : r.order_code },
    { key: "product_name", label: "Sản phẩm", render: r => `${r.product_code} - ${r.product_name}` },
    { key: "total_qty", label: "Thành phẩm", align: "right", render: r => <span className="font-semibold text-emerald-600">{fmt(r.total_qty)} {r.unit}</span> },
    { key: "completed_date", label: "Ngày cập nhật", align: "center", render: r => r.completed_date ? <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">{new Date(r.completed_date).toLocaleDateString("vi-VN")}</span> : "—" },
    { key: "last_completed_at", label: "TG cập nhật (cuối)", align: "right", render: r => new Date(r.last_completed_at).toLocaleTimeString("vi-VN") },
  ];

  return (
    <div className="space-y-6">
      {/* FILTER HEADER (Local to Form for Date, but visually fits below the global worker) */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 flex flex-wrap gap-6 shadow-sm">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Ngày ghi nhận</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-2.5 text-slate-400" size={18} />
            <input type="date" className={inputCls + " pl-10 bg-slate-50 border-slate-200 focus:bg-white"} 
              value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>
        <div className="flex-[2]">
           {/* Placeholder if we need more form-specific filters */}
           <div className="h-full flex items-center justify-end text-sm text-slate-500">
              Công nhân đang chọn: <span className="font-semibold ml-2 text-blue-600">{worker || "Chưa chọn"}</span>
           </div>
        </div>
      </div>

      {/* CONTENT */}
      {worker ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* LEFT: WO LIST */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="font-semibold text-slate-700 flex items-center gap-2">
                  <List size={18} className="text-slate-400"/> Lệnh SX liên quan
                </div>
                <div className="flex items-center gap-3">
                  {wos.length > 0 && (
                    <div className="text-sm text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200">
                      Tổng cộng: <span className="font-bold text-slate-800">{wos.length}</span> lệnh
                    </div>
                  )}
                  <span className="text-xs text-slate-400 italic">Hiển thị WO trong ngày {new Date(date).toLocaleDateString("vi-VN")}</span>
                </div>
              </div>
              <div className="p-4">
                {loading ? (
                  <div className="py-8 text-center text-slate-500 animate-pulse">Đang tải dữ liệu...</div>
                ) : wos.length === 0 ? (
                  <div className="py-12 text-center">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <CheckCircle2 className="text-slate-300" size={32} />
                    </div>
                    <p className="text-slate-500">Công nhân chưa có lệnh sản xuất nào trong ngày này.</p>
                  </div>
                ) : (
                  <DataTable rows={wos} columns={woCols} rowKey={r => r.order_code + r.product_id} dense />
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: SCRAP INPUT FORM */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm sticky top-6">
              <div className={`px-5 py-4 border-b flex items-center justify-between gap-2 ${record ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'}`}>
                <div className="flex items-center gap-2">
                  {record ? (
                    <Edit2 size={18} className="text-amber-600" />
                  ) : (
                    <FileText size={18} className="text-blue-600" />
                  )}
                  <h3 className={`font-semibold ${record ? 'text-amber-800' : 'text-slate-800'}`}>
                    {record ? "Cập nhật Phế Phẩm" : "Ghi nhận Phế Phẩm"}
                  </h3>
                </div>
                {cameFromManage && onBack && (
                  <button onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-slate-700 underline">
                    Quay lại danh sách
                  </button>
                )}
              </div>
              
              <div className="p-5 space-y-6">
                {productGroups.length === 0 ? (
                  <p className="text-sm text-slate-500 italic text-center py-4">Chưa có thành phẩm nào.</p>
                ) : (
                  <>
                    <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/80 shadow-sm">
                      <div className="mb-4">
                        <label className="block text-sm font-bold text-slate-700 uppercase mb-2">Người ghi nhận <span className="text-rose-500">*</span></label>
                        <input 
                          type="text"
                          className={inputCls + " font-semibold text-blue-700 disabled:opacity-70 disabled:bg-slate-100"} 
                          value={recorderName}
                          onChange={e => setRecorderName(e.target.value)}
                          placeholder="Nhập tên người ghi nhận (hoặc để mặc định)"
                          disabled={record && !cameFromManage}
                        />
                      </div>
                      
                      <div className="mt-4">
                        <label className="block text-sm font-bold text-slate-700 uppercase mb-2">Số lượng phế thực nhận (Kg) <span className="text-rose-500">*</span></label>
                        <input 
                          type="number" min="0" step="0.1"
                          className={inputCls + " text-2xl text-right font-bold text-rose-600 disabled:opacity-70 disabled:bg-slate-100"} 
                          value={scrapQty}
                          onChange={e => setScrapQty(e.target.value)}
                          placeholder="0.0"
                          disabled={record && !cameFromManage}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 uppercase mb-1.5">Ghi chú thêm</label>
                      <textarea 
                        className={inputCls + " resize-none disabled:opacity-70 disabled:bg-slate-100"} 
                        rows={2}
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Nguyên nhân phế, lỗi kỹ thuật..."
                        disabled={record && !cameFromManage}
                      />
                    </div>

                    {(!record || cameFromManage) ? (
                      <button 
                        onClick={handleSave} 
                        disabled={saving || loading}
                        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Save size={18} /> {saving ? "Đang lưu..." : (record ? "Cập nhật dữ liệu" : "Xác nhận ghi nhận")}
                      </button>
                    ) : (
                      <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-4 rounded-lg text-sm text-center flex flex-col items-center gap-2">
                        <CheckCircle2 size={24} className="text-emerald-500" />
                        <div>
                          <p className="font-semibold">Đã ghi nhận phế phẩm hôm nay.</p>
                          <p className="text-emerald-600/90 mt-1">Vui lòng liên hệ Quản lý (vào tab Điều chỉnh phế) để sửa nếu có sai sót.</p>
                        </div>
                      </div>
                    )}
                    
                    {(record && cameFromManage) && (
                      <p className="text-xs text-center text-slate-400 mt-2">
                        Đã ghi nhận lần cuối lúc {new Date(record.updated_at).toLocaleTimeString("vi-VN")}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center bg-white rounded-xl border border-slate-200">
          <Users className="mx-auto h-12 w-12 text-slate-300 mb-3" />
          <p className="text-slate-500">Vui lòng chọn công nhân ở phía trên để nhập liệu</p>
        </div>
      )}
    </div>
  );
}

// ----- MANAGEMENT COMPONENT -----
function ScrapManagement({ onEdit }) {
  const [date, setDate] = useState(todayYmd());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await scrap.allRecords(date);
      setRecords(res || []);
    } catch (e) {
      toast.error("Lỗi lấy danh sách ghi nhận phế: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    if (!search) return records;
    const lower = search.toLowerCase();
    return records.filter(r => 
      (r.worker_name || "").toLowerCase().includes(lower) || 
      (r.employee_name || "").toLowerCase().includes(lower)
    );
  }, [search, records]);

  const cols = [
    { key: "record_date", label: "Ngày ghi nhận", render: r => new Date(r.record_date).toLocaleDateString("vi-VN") },
    { key: "worker_name", label: "Công nhân SX", tdClass: "font-medium text-slate-700" },
    { key: "recorder_name", label: "Người ghi nhận", render: r => r.recorder_name || r.worker_name, tdClass: "font-medium text-blue-600" },
    { key: "total_scrap", label: "Số lượng phế (Kg)", align: "right", render: r => <span className="font-bold text-rose-600">{fmt(r.total_scrap)}</span> },
    { key: "note", label: "Ghi chú", tdClass: "text-slate-500 text-sm" },
    { key: "updated_at", label: "Cập nhật lúc", render: r => new Date(r.updated_at).toLocaleTimeString("vi-VN") },
    { 
      key: "actions", label: "", align: "right", 
      render: r => (
        <button 
          onClick={() => onEdit(r)}
          className="text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded text-sm font-medium transition-colors"
        >
          Điều chỉnh phế
        </button>
      )
    }
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex flex-wrap gap-4 justify-between items-center bg-slate-50">
        <div className="flex items-center gap-4">
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
          <input 
            type="text" 
            className={inputCls + " w-64"} 
            placeholder="Tìm theo tên công nhân..." 
            value={search} onChange={e => setSearch(e.target.value)} 
          />
        </div>
        <button onClick={loadData} className="btn-ghost flex items-center gap-1.5 text-sm">
          <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Làm mới
        </button>
      </div>
      <div className="p-0">
        <DataTable rows={filtered} columns={cols} rowKey={r => r.id} />
      </div>
    </div>
  );
}

export default function ScrapModule({ onOpenOrder }) {
  const { can } = usePerm();
  const [activeTab, setActiveTab] = useState("record");
  const [cameFromManage, setCameFromManage] = useState(false);
  
  // GLOBAL STATE
  const [worker, setWorker] = useState("");
  const [workerList, setWorkerList] = useState([]);
  const [date, setDate] = useState(todayYmd()); // For recording form

  // Load all workers who worked recently
  useEffect(() => {
    scrap.workers().then(res => {
      setWorkerList(res || []);
    }).catch(e => toast.error("Lỗi lấy danh sách công nhân: " + e.message));
  }, []);

  // worker = id nhân viên; suy ra tên để các màn đọc (theo tên) vẫn chạy
  const workerName = workerList.find(x => x.id === worker)?.name || "";

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Ghi nhận Phế phẩm" 
        icon={Trash2}
        description="Ghi nhận và quản lý lượng phế phẩm phát sinh theo công nhân."
      />
      
      {/* GLOBAL WORKER FILTER */}
      {activeTab !== "manage" && (
        <div className="bg-white p-5 rounded-xl border border-blue-200 shadow-sm bg-gradient-to-r from-blue-50 to-white">
          <div className="max-w-md">
            <label className="block text-sm font-bold text-blue-900 uppercase tracking-wider mb-2">Công nhân thực hiện</label>
            <div className="relative">
              <Users className="absolute left-3 top-2.5 text-blue-500" size={18} />
              <select className={inputCls + " pl-10 border-blue-200 focus:border-blue-500 focus:ring-blue-500 font-medium"}
                value={worker} onChange={e => setWorker(e.target.value)}>
                <option value="">-- Vui lòng chọn công nhân --</option>
                {workerList.map(w => (
                  <option key={w.id} value={w.id}>{w.employee_code ? `${w.employee_code} · ` : ""}{w.name}</option>
                ))}
              </select>
            </div>
            {workerList.length === 0 && (
              <p className="text-xs text-rose-500 mt-2 flex items-center gap-1">Chưa có công nhân nào phát sinh dữ liệu gần đây.</p>
            )}
          </div>
        </div>
      )}

      {/* TABS */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => {
            setActiveTab("record");
            setCameFromManage(false);
          }}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
            ${activeTab === "record" ? "border-blue-600 text-blue-600 bg-blue-50/50" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}
        >
          <FileText size={16} /> Nhập liệu Phế phẩm
        </button>
        <button
          onClick={() => setActiveTab("stats")}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
            ${activeTab === "stats" ? "border-blue-600 text-blue-600 bg-blue-50/50" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}
        >
          <TrendingUp size={16} /> Thống kê 7 Ngày
        </button>
        {can("scrap", "edit") && (
          <button
            onClick={() => setActiveTab("manage")}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
              ${activeTab === "manage" ? "border-amber-600 text-amber-600 bg-amber-50/50" : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"}`}
          >
            <Settings2 size={16} /> Quản lý / Điều chỉnh phế
          </button>
        )}
      </div>

      <div className="py-2">
        {activeTab === "record" ? (
          <ScrapForm 
            worker={workerName} 
            workerId={worker} 
            date={date} 
            setDate={setDate} 
            onOpenOrder={onOpenOrder} 
            cameFromManage={cameFromManage}
            onBack={() => {
              setActiveTab("manage");
              setCameFromManage(false);
            }}
          />
        ) : activeTab === "manage" ? (
          <ScrapManagement onEdit={(r) => {
             // Map worker_name back to worker ID
             const found = workerList.find(w => w.name === r.worker_name);
             if (found) setWorker(found.id);
             setDate(r.record_date.slice(0, 10));
             setCameFromManage(true);
             setActiveTab("record");
          }} />
        ) : (
          <ScrapStatistics worker={workerName} onOpenOrder={onOpenOrder} />
        )}
      </div>
    </div>
  );
}
