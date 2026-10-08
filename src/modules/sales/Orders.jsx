import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, Plus, Trash2, Pencil, ArrowLeft, Save, FileText, Printer, Copy, Upload, CheckCircle, XCircle, AlertCircle, CalendarClock } from "lucide-react";
import { resource, salesOrders as salesOrdersApi, planning, processes } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import {  inputCls, fmt, fmtDate, fmtDateTime, statusClass, dueTone , toast } from "../../ui.js";
import { PageHeader, ListHeader, Section, usePager, DataTable, UnitSelect, DateInput, Logo, SearchSelect } from '../../components.jsx';
import { PRODUCT_SPECS, SPEC_NAMES, splitNU, specShort } from "../../specs.js";
import * as XLSX from "xlsx";

const ordersApi = resource("sales-orders");
const STATUSES = [
  "Mới",
  "Đang sản xuất",
  "Hoàn thành sản xuất",
  "Chuyển hàng 1 phần",
  "Đang vận chuyển",
  "Đã vận chuyển, chưa thanh toán",
  "Đã thanh toán",
  "Hoàn thành",
  "Đã hủy",
];

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label} {required && <span className="text-rose-500">*</span>}</label>
    {children}
  </div>
);

/* Bộ ô nhập thông số kỹ thuật cho 1 dòng hàng */
function SpecFields({ specs, onChange, disabled }) {
  const get = (n) => specs?.[n] || "";
  const setV = (n, v) => { const next = { ...specs }; if (v) next[n] = v; else delete next[n]; onChange(next); };
  const cls = inputCls + (disabled ? " bg-slate-50" : "");
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {PRODUCT_SPECS.map((spec) => {
        const lbl = <span className="block text-xs font-medium text-slate-500 mb-1">{spec.label || spec.name}</span>;
        if (spec.kind === "text") return (
          <label key={spec.name}>{lbl}
            <input className={cls} disabled={disabled} value={get(spec.name)} placeholder={spec.placeholder || ""}
              onChange={(e) => setV(spec.name, e.target.value)} />
          </label>
        );
        if (spec.kind === "select") return (
          <label key={spec.name}>{lbl}
            <select className={cls} disabled={disabled} value={get(spec.name)} onChange={(e) => setV(spec.name, e.target.value)}>
              <option value="">-- Chọn --</option>{spec.options.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        );
        if (spec.kind === "num") { const { num } = splitNU(get(spec.name)); return (
          <label key={spec.name}>{lbl}
            <div className="relative">
              <input type="number" className={cls + " pr-10"} disabled={disabled} value={num} placeholder="0"
                onChange={(e) => setV(spec.name, e.target.value ? `${e.target.value} ${spec.unit}` : "")} />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">{spec.unit}</span>
            </div>
          </label>
        ); }
        const { num, unit } = splitNU(get(spec.name)); const cu = unit || spec.units[0];
        return (
          <label key={spec.name}>{lbl}
            <div className="flex gap-1.5">
              <input type="number" className={cls + " flex-1"} disabled={disabled} value={num} placeholder="0"
                onChange={(e) => setV(spec.name, e.target.value ? `${e.target.value} ${cu}` : "")} />
              <select className={cls + " w-20"} disabled={disabled} value={cu}
                onChange={(e) => setV(spec.name, num ? `${num} ${e.target.value}` : "")}>
                {spec.units.map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
          </label>
        );
      })}
    </div>
  );
}

/* ---- Tag Nguyên vật liệu cho từng dòng hàng (định mức từ BOM) ---- */
function MaterialTag({ materials }) {
  if (!materials || !materials.length) return null;
  return (
    <div className="pl-8">
      <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Nguyên vật liệu</div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-100 text-slate-500">
            <tr>
              {["Mã NVL", "Tên vật tư", "ĐVT", "Định mức", "Tồn kho", "Cần bổ sung", "Đã dùng cho đơn"].map((h) =>
                <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.material_id} className="border-t border-slate-100">
                <td className="px-2 py-1.5 font-medium text-slate-700 whitespace-nowrap">{m.material_code}</td>
                <td className="px-2 py-1.5 text-slate-700">{m.material_name}</td>
                <td className="px-2 py-1.5 text-slate-500">{m.unit}</td>
                <td className="px-2 py-1.5 text-right">{fmt(m.required)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(m.on_hand)}</td>
                <td className={"px-2 py-1.5 text-right font-medium " + (Number(m.to_replenish) > 0 ? "text-rose-600" : "text-emerald-600")}>{fmt(m.to_replenish)}</td>
                <td className="px-2 py-1.5 text-right text-slate-600">{fmt(m.used)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- Danh sách Lệnh sản xuất gắn với dòng hàng (1 dòng → nhiều LSX) ---- */
function LsxLinks({ orders, onOpenProductionOrder }) {
  return (
    <div className="pl-8">
      <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Lệnh sản xuất</div>
      {orders && orders.length ? (
        <div className="flex flex-wrap gap-2">
          {orders.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs">
              <a href="#" onClick={(e) => { e.preventDefault(); onOpenProductionOrder && onOpenProductionOrder(o.id); }} className="font-semibold text-blue-600 hover:underline" title="Đến màn Lệnh sản xuất">{o.order_code}</a>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">{fmt(o.quantity)} {o.unit}</span>
              <span className={"px-1.5 py-0.5 rounded-full text-[10px] " + statusClass(o.status)}>{o.status}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-xs text-slate-400 italic">Chưa có lệnh sản xuất — tạo ở màn Kế hoạch SX.</div>
      )}
    </div>
  );
}

/* ---- Modal phân công nhanh từ chi tiết đơn hàng ---- */
const mapStageName = (s) => (/c[ắa]t/i.test(`${s.name || ''} ${s.workshop || ''} ${s.machine_name || ''}`) ? 'Cắt' : 'Thổi');
const stageFactory = (stage) => (stage === 'Cắt' ? 'Nhà máy cắt' : 'Nhà máy thổi');

function QuickAllocateModal({ orderId, orderItems, lookups, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [batchItems, setBatchItems] = useState([]); // items còn remaining thuộc đơn này
  const [fullyCovered, setFullyCovered] = useState(false);
  const [planned_date, setPlannedDate] = useState('');
  const [qty, setQty] = useState({});
  const [stages, setStages] = useState([]);
  const [loadingProc, setLoadingProc] = useState(true);
  const emps = lookups.employees || [];
  const teams = [...new Set(emps.map((e) => e.factory).filter(Boolean))];
  const machinesOf = (team) => (lookups.machines || []).filter((m) => !team || m.factory === team);
  const workersOf = (team) => emps.filter((e) => !team || e.factory === team);

  // IDs của các dòng hàng trong đơn này — dùng để lọc batch items chính xác
  const orderItemIds = new Set((orderItems || []).map((it) => it.id).filter(Boolean));

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const r = await planning.fromOrders();
        const allItems = (r.batches || []).flatMap((b) => b.items || []);

        // Ưu tiên match theo item_id (chính xác nhất); fallback theo order_code nếu cần
        const orderCodes = new Set((orderItems || []).map((it) => it.order_code).filter(Boolean));
        const mine = allItems.filter((it) =>
          orderItemIds.has(it.item_id) ||
          it.sales_order_id === orderId ||
          it.order_id === orderId ||
          (it.order_code && orderCodes.has(it.order_code))
        );

        if (!cancel) {
          if (!mine.length) {
            setFullyCovered(true);
          } else {
            setBatchItems(mine);
            setQty(Object.fromEntries(mine.map((i) => [i.item_id, String(Number(i.remaining ?? i.quantity) || 0)])));

            // Nạp công đoạn: thử dùng phân bổ từ LSX gần nhất trước, fallback về quy trình template
            const productId = mine[0]?.product_id;
            if (productId) {
              let stagesLoaded = false;
              // Thử lấy tasks từ LSX cuối cùng của đơn hàng này
              const allLsx = (orderItems || []).flatMap((it) => it.production_orders || []);
              if (allLsx.length) {
                try {
                  // Lấy LSX mới nhất (phần tử cuối)
                  const latestLsx = allLsx[allLsx.length - 1];
                  const tasks = await production.getTasks(latestLsx.id);
                  if (tasks && tasks.length && !cancel) {
                    const rows = tasks.map((t, i) => ({
                      _k: i,
                      name: t.name || t.stage || '',
                      stage: t.stage || 'Thổi',
                      machine_id: t.machine_id || '',
                      shift: t.shift || '',
                      assigned_team: t.assigned_team || '',
                      assigned_worker: t.assigned_worker || '',
                    }));
                    if (!cancel) { setStages(rows); stagesLoaded = true; }
                  }
                } catch { /* fallback về process template */ }
              }
              // Nếu chưa có từ LSX → load từ process template
              if (!stagesLoaded) {
                try {
                  const list = await processes.list({ product_id: productId });
                  if (list.length) {
                    const proc = await processes.get(list[0].id);
                    const rows = (proc.steps || []).map((s, i) => {
                      const stage = mapStageName(s);
                      return { _k: i, name: s.name || stage, stage, machine_id: (s.machine_ids?.[0]) || s.machine_id || '', shift: '', assigned_team: s.workshop || stageFactory(stage), assigned_worker: '' };
                    });
                    if (!cancel) setStages(rows);
                  }
                } catch { /* bỏ qua nếu chưa có quy trình */ }
              }
            }
          }
        }
      } catch (e) { toast.error('Lỗi tải dữ liệu: ' + e.message); }
      finally { if (!cancel) { setLoading(false); setLoadingProc(false); } }
    })();
    return () => { cancel = true; };
  }, [orderId]); // eslint-disable-line

  const setStage = (k, field, v) => setStages((arr) => arr.map((s) => {
    if (s._k !== k) return s;
    const nx = { ...s, [field]: v };
    if (field === 'assigned_team') { const keep = emps.find((e) => e.name === s.assigned_worker && (!v || e.factory === v)); nx.assigned_worker = keep ? s.assigned_worker : ''; }
    return nx;
  }));

  const save = async () => {
    const planItems = batchItems.map((i) => ({ item_id: i.item_id, qty: qty[i.item_id] })).filter((x) => Number(x.qty) > 0);
    if (!planItems.length) return toast.error('Nhập số lượng sản xuất cho ít nhất 1 dòng.');
    try {
      const r = await planning.generate({
        items: planItems, planned_date,
        stages: stages.map((s) => ({ stage: s.stage, name: s.name, machine_id: s.machine_id, shift: s.shift, assigned_team: s.assigned_team, assigned_worker: s.assigned_worker })),
      });
      toast.success(`Đã tạo ${r.created.length} lệnh sản xuất: ${r.created.join(', ')}`);
      onDone();
    } catch (e) { toast.error('Lỗi tạo lệnh: ' + e.message); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><CalendarClock size={20} className="text-blue-600" /> Phân công nhanh</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-slate-400">Đang tải dữ liệu…</div>
        ) : fullyCovered ? (
          <div className="py-6 space-y-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle size={20} className="text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-emerald-800">Đơn hàng đã có đủ lệnh sản xuất</div>
                <div className="text-sm text-emerald-700 mt-0.5">Tất cả dòng hàng trong đơn đã được phân bổ đủ số lượng vào lệnh SX. Không cần tạo thêm.</div>
              </div>
            </div>
            <div className="flex justify-end"><button onClick={onClose} className="btn-ghost">Đóng</button></div>
          </div>
        ) : (
          <>
            <div>
              <div className="text-sm font-medium text-slate-600 mb-1.5">Số lượng sản xuất theo dòng đơn <span className="text-slate-400 font-normal">(có thể lập một phần)</span></div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr><th className="text-left px-3 py-2">Đơn hàng</th><th className="text-left px-3 py-2">Khách</th>
                      <th className="text-right px-3 py-2">Còn lại</th><th className="text-right px-3 py-2 w-28">SL sản xuất</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batchItems.map((it) => {
                      const rem = Number(it.remaining ?? it.quantity) || 0;
                      return (
                        <tr key={it.item_id}>
                          <td className="px-3 py-2 font-medium text-blue-600">{it.order_code}</td>
                          <td className="px-3 py-2 text-slate-600">{it.customer_name || '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{fmt(rem)} {it.unit}</td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" min="0" max={rem} className={inputCls + ' text-right py-1'}
                              value={qty[it.item_id]} onChange={(e) => setQty((p) => ({ ...p, [it.item_id]: e.target.value }))} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Nhập nhỏ hơn số còn lại nếu chỉ sản xuất trước một phần — phần còn lại vẫn nằm chờ trong kế hoạch.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-slate-600 mb-1.5">Ngày bắt đầu sản xuất</label>
                <input type="date" className={inputCls} value={planned_date} onChange={(e) => setPlannedDate(e.target.value)} />
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-slate-600 mb-1.5">Phân bổ theo công đoạn <span className="text-slate-400 font-normal">(công đoạn nối tiếp: xong công đoạn trước mới sang công đoạn sau)</span></div>
              {loadingProc ? (
                <div className="text-sm text-slate-400 py-4 text-center">Đang nạp quy trình…</div>
              ) : !stages.length ? (
                <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">Sản phẩm chưa có quy trình công nghệ — lệnh sẽ tạo không kèm công đoạn.</div>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2 w-10">#</th>
                        <th className="text-left px-3 py-2">Công đoạn</th>
                        <th className="text-left px-3 py-2">Máy</th>
                        <th className="text-left px-3 py-2">Công nhân</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stages.map((s, idx) => (
                        <tr key={s._k}>
                          <td className="px-3 py-2 text-slate-400 font-semibold">{idx + 1}</td>
                          <td className="px-3 py-2"><span className="font-medium text-slate-700">{s.name}</span><span className="text-slate-400"> · {s.stage}</span></td>
                          <td className="px-2 py-2">
                            <select className={inputCls + ' py-1'} value={s.machine_id} onChange={(e) => setStage(s._k, 'machine_id', e.target.value)}>
                              <option value="">-- Chọn máy --</option>
                              {machinesOf(s.assigned_team).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <select className={inputCls + ' py-1'} value={s.assigned_worker} onChange={(e) => setStage(s._k, 'assigned_worker', e.target.value)}>
                              <option value="">-- Công nhân --</option>
                              {workersOf(s.assigned_team).map((e) => <option key={e.id} value={e.name}>{e.name}{e.position ? ` · ${e.position}` : ''}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="btn-ghost">Hủy</button>
              <button onClick={save} className="btn-primary"><Save size={16} /> Tạo {batchItems.map(i => qty[i.item_id]).filter(q => Number(q) > 0).length} lệnh</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---- Form đơn hàng ---- */
function OrderForm({ lookups, editId, copyId, onBack, onSaved, onPrint, onCreateDelivery, onOpenProductionOrder }) {
  const { can, fperm, fpermSecret } = usePerm();
  const fhid = (k) => fperm("orders", k) === "hidden";
  const fdis = (k) => fperm("orders", k) !== "edit";
  const moneyPerm = fpermSecret("orders", "amounts"); // 'edit' | 'view' | 'hidden'
  const showMoney = moneyPerm !== "hidden";
  const today = new Date().toISOString().slice(0, 10);
  const [editing, setEditing] = useState(!editId); // tạo mới = sửa ngay; mở sẵn = xem
  const [allocating, setAllocating] = useState(false);
  const [f, setF] = useState({ customer_id: "", order_date: today, due_date: "", status: "Mới", note: "", priority: "Trung bình", mix_ratio: [] });
  const [items, setItems] = useState([{ _k: 1, product_id: "", quantity: "", unit: "", specs: {}, core_weight: "", total_weight: "", note: "", planned_start_date: "", planned_end_date: "", material_type: null, unit_price: "" }]);
  const [seq, setSeq] = useState(2);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const loadData = useCallback(() => {
    if (!editId) return;
    ordersApi.get(editId).then((d) => {
      setF({ customer_id: d.customer_id, order_date: d.order_date?.slice(0, 10) || today, due_date: d.due_date?.slice(0, 10) || "", status: d.status, note: d.note || "", priority: d.priority || "Trung bình", mix_ratio: d.mix_ratio || [] });
      setItems((d.items || []).map((it, i) => ({ _k: i + 1, id: it.id, product_id: it.product_id, quantity: it.quantity, unit: it.unit || "", specs: it.specs || {}, core_weight: it.core_weight ?? "", total_weight: it.total_weight ?? "", note: it.note || "", planned_start_date: it.planned_start_date?.slice(0, 10) || "", planned_end_date: it.planned_end_date?.slice(0, 10) || "", actual_start_date: it.actual_start_date || null, actual_end_date: it.actual_end_date || null, materials: it.materials || [], production_orders: it.production_orders || [], material_type: it.material_type || null, mix_ratio: it.mix_ratio || [], unit_price: it.unit_price ?? "" })));
      setSeq((d.items?.length || 0) + 1);
    }).catch((e) => toast.error("Lỗi tải đơn: " + e.message));
  }, [editId]); // eslint-disable-line
  useEffect(() => { loadData(); }, [loadData]);

  // Sao chép từ đơn nguồn → đơn mới (không gắn editId nên Lưu sẽ tạo mới)
  useEffect(() => {
    if (editId || !copyId) return;
    ordersApi.get(copyId).then((d) => {
      setF({ customer_id: d.customer_id, order_date: today, due_date: "", status: "Mới", note: d.note || "", priority: d.priority || "Trung bình", mix_ratio: d.mix_ratio || [] });
      setItems((d.items || []).map((it, i) => ({ _k: i + 1, product_id: it.product_id, quantity: it.quantity, unit: it.unit || "", specs: it.specs || {}, core_weight: it.core_weight ?? "", total_weight: it.total_weight ?? "", note: it.note || "", planned_start_date: "", planned_end_date: "", material_type: it.material_type || null, mix_ratio: it.mix_ratio || [], unit_price: it.unit_price ?? "" })));
      setSeq((d.items?.length || 0) + 1);
    }).catch((e) => toast.error("Lỗi tải đơn nguồn để sao chép: " + e.message));
  }, [copyId, editId]); // eslint-disable-line

  const addItem = () => { setItems((a) => [...a, { _k: seq, product_id: "", quantity: "", unit: "", specs: {}, core_weight: "", total_weight: "", note: "", planned_start_date: "", planned_end_date: "", material_type: null, mix_ratio: [], unit_price: "" }]); setSeq((s) => s + 1); };
  const rmItem = (k) => setItems((a) => a.filter((x) => x._k !== k));
  const upItem = (k, fld, v) => setItems((a) => a.map((x) => {
    if (x._k !== k) return x;
    const nx = { ...x, [fld]: v };
    if (fld === "product_id") { const p = lookups.products.find((pp) => pp.id === v); if (p) nx.unit = p.unit || x.unit || ""; }
    // Hàng cuộn: tổng khối lượng = số lượng + khối lượng lõi (lõi trống tính = 0)
    if (fld === "quantity" || fld === "core_weight") {
      const q = Number(nx.quantity);
      const c = (nx.core_weight === "" || nx.core_weight == null) ? 0 : Number(nx.core_weight);
      if (nx.quantity !== "" && nx.quantity != null && !Number.isNaN(q) && !Number.isNaN(c))
        nx.total_weight = String(q + c);
    }
    return nx;
  }));

  const save = async () => {
    if (!f.customer_id) return toast.error("Chọn khách hàng");
    const valid = items.filter((it) => it.product_id && it.quantity);
    if (!valid.length) return toast.error("Cần ít nhất 1 dòng hàng");
    try {
      if (editId) {
        await ordersApi.update(editId, { ...f, items: valid });
        toast.success("Đã lưu thành công");
        setEditing(false); loadData(); // ở lại màn chi tiết, không thoát ra list
      } else {
        await ordersApi.create({ ...f, items: valid });
        toast.success("Đã lưu thành công"); onSaved(); // tạo mới → về list
      }
    } catch (e) { toast.error("Lỗi lưu đơn hàng: " + e.message); }
  };

  const del = async () => {
    if (!confirm("Xóa đơn hàng này?")) return;
    try { await ordersApi.remove(editId); toast.success("Đã xóa thành công"); onSaved(); } catch (e) { toast.error("Lỗi xóa: " + e.message); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={!editId ? (copyId ? "Tạo đơn hàng (sao chép)" : "Tạo đơn hàng") : editing ? "Sửa đơn hàng" : "Chi tiết đơn hàng"} onBack={onBack}
        actions={editId && !editing ? (<>
          <button onClick={() => onPrint?.(editId)} className="btn-ghost"><Printer size={16} /> In phiếu</button>
          {onCreateDelivery && <button onClick={() => onCreateDelivery(editId)} className="btn-ghost text-blue-600 border-blue-200 hover:bg-blue-50"><FileText size={16} /> Tạo phiếu giao hàng</button>}
          {["Mới", "Đang sản xuất"].includes(f.status) && can("planning", "edit") && (
            <button onClick={() => setAllocating(true)} className="btn-primary"><CalendarClock size={16} /> Phân công nhanh</button>
          )}
          {can("orders", "edit") && <button onClick={() => setEditing(true)} className="btn-ghost"><Pencil size={16} /> Sửa</button>}
          {can("orders", "delete") && <button onClick={del} className="btn-ghost" style={{ color: "#e11d48" }}><Trash2 size={16} /> Xóa</button>}
        </>) : (<>
          {editId && <button onClick={() => { setEditing(false); loadData(); }} className="btn-ghost">Hủy</button>}
          <button onClick={save} className="btn-primary"><Save size={16} /> Lưu đơn hàng</button>
        </>)} />

      <fieldset disabled={!editing} className="space-y-5">
      <Section title="Thông tin đơn hàng">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
        {!fhid("customer_id") && <Field label="Khách hàng" required>
          <SearchSelect value={f.customer_id} disabled={fdis("customer_id")} placeholder="-- Chọn khách hàng --"
            options={lookups.customers.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => set("customer_id", v)} />
        </Field>}
        {!fhid("status") && <Field label="Trạng thái">
          <select className={inputCls} disabled={fdis("status")} value={f.status} onChange={(e) => set("status", e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>}
        {!fhid("priority") && <Field label="Độ ưu tiên">
          <select className={inputCls} disabled={fdis("priority")} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
            <option value="Cao">Cao (Gấp)</option>
            <option value="Trung bình">Trung bình</option>
            <option value="Thấp">Thấp</option>
          </select>
        </Field>}
        {!fhid("order_date") && <Field label="Ngày đặt"><DateInput className={inputCls} disabled={fdis("order_date")} value={f.order_date} onChange={(e) => set("order_date", e.target.value)} /></Field>}
        {!fhid("due_date") && <Field label="Ngày giao"><DateInput className={inputCls} disabled={fdis("due_date")} value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></Field>}
        </div>
      </Section>


      {!fhid("items") && (
      <Section title="Dòng hàng" action={!fdis("items") && <button onClick={addItem} className="btn-ghost text-blue-600 border-blue-200 hover:bg-blue-50"><Plus size={16} /> Thêm dòng</button>}>
        <div className="space-y-3">
          {items.map((it, idx) => (
            <div key={it._k} className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50/40">
              <div className="flex items-start gap-3">
                <span className="mt-2.5 text-xs font-semibold text-slate-400 w-5 shrink-0">#{idx + 1}</span>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-7">
                    <span className="block text-xs font-medium text-slate-500 mb-1">Sản phẩm</span>
                    <SearchSelect value={it.product_id} disabled={fdis("items")} placeholder="-- Chọn sản phẩm --"
                      options={lookups.products.map((p) => ({ value: p.id, label: `${p.product_code} · ${p.product_name}` }))}
                      onChange={(v) => upItem(it._k, "product_id", v)} />
                  </div>
                  <div className="md:col-span-3">
                    <span className="block text-xs font-medium text-slate-500 mb-1">Số lượng</span>
                    <input type="number" min="0" className={inputCls} disabled={fdis("items")} value={it.quantity} onChange={(e) => upItem(it._k, "quantity", e.target.value)} />
                  </div>
                  <div className="md:col-span-2">
                    <span className="block text-xs font-medium text-slate-500 mb-1">ĐVT</span>
                    <UnitSelect value={it.unit} disabled={fdis("items")} onChange={(v) => upItem(it._k, "unit", v)} />
                  </div>
                </div>
                {!fdis("items") && <button onClick={() => rmItem(it._k)} className="mt-6 text-slate-400 hover:text-rose-600 p-1 shrink-0"><Trash2 size={16} /></button>}
              </div>
              <div className="pl-8">
                <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Thông số kỹ thuật</div>
                <SpecFields specs={it.specs} disabled={fdis("items")} onChange={(s) => upItem(it._k, "specs", s)} />
              </div>
              <div className="pl-8">
                <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Khối lượng (hàng cuộn)</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <label>
                    <span className="block text-xs font-medium text-slate-500 mb-1">KL lõi cuộn (kg)</span>
                    <input type="number" min="0" className={inputCls} disabled={fdis("items")} value={it.core_weight}
                      placeholder="0" onChange={(e) => upItem(it._k, "core_weight", e.target.value)} />
                  </label>
                  <label>
                    <span className="block text-xs font-medium text-slate-500 mb-1">Tổng khối lượng (kg)</span>
                    <input type="number" min="0" className={inputCls} disabled={fdis("items")} value={it.total_weight}
                      placeholder="= SL + lõi" onChange={(e) => upItem(it._k, "total_weight", e.target.value)} />
                  </label>
                </div>
              </div>
              {showMoney && (
              <div className="pl-8">
                <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Giá</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label>
                    <span className="block text-xs font-medium text-slate-500 mb-1">Đơn giá</span>
                    <input type="text" className={inputCls} disabled={fdis("items") || moneyPerm !== "edit"} 
                      value={it.unit_price ? Number(it.unit_price).toLocaleString("vi-VN") : ""}
                      placeholder="0" onChange={(e) => upItem(it._k, "unit_price", e.target.value.replace(/\D/g, ""))} />
                  </label>
                  <label>
                    <span className="block text-xs font-medium text-slate-500 mb-1">Thành tiền (trước VAT)</span>
                    <div className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold">
                      {fmt((Number(it.unit_price) || 0) * (Number(it.quantity) || 0))} đ
                    </div>
                  </label>
                  <label>
                    <span className="block text-xs font-medium text-slate-500 mb-1">Thành tiền (sau VAT 8%)</span>
                    <div className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-blue-700 font-semibold">
                      {fmt(((Number(it.unit_price) || 0) * (Number(it.quantity) || 0)) * 1.08)} đ
                    </div>
                  </label>
                </div>
              </div>
              )}
              <div className="pl-8">
                <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Loại nguyên liệu</div>
                <div className="flex gap-4">
                  <label className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 cursor-pointer transition-all select-none ${
                    it.material_type === 'zin'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  } ${editing && !fdis("items") ? '' : 'cursor-default pointer-events-none'}`}>
                    <input type="checkbox" className="hidden" disabled={!editing || fdis("items")}
                      checked={it.material_type === 'zin'}
                      onChange={() => upItem(it._k, "material_type", it.material_type === 'zin' ? null : 'zin')} />
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      it.material_type === 'zin' ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'
                    }`}>
                      {it.material_type === 'zin' && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 16 16"><path d="M13.485 1.431a1.473 1.473 0 0 1 2.104 2.062l-7.84 9.801a1.473 1.473 0 0 1-2.12.04L.431 8.138a1.473 1.473 0 0 1 2.084-2.083l4.111 4.112 6.82-8.69a.486.486 0 0 1 .04-.046z"/></svg>}
                    </span>
                    <span className="text-sm font-medium">Hàng zin</span>
                    <span className="text-xs text-slate-400">(100% nhựa nguyên sinh)</span>
                  </label>
                  <label className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 cursor-pointer transition-all select-none ${
                    it.material_type === 'pha'
                      ? 'border-amber-500 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  } ${editing && !fdis("items") ? '' : 'cursor-default pointer-events-none'}`}>
                    <input type="checkbox" className="hidden" disabled={!editing || fdis("items")}
                      checked={it.material_type === 'pha'}
                      onChange={() => upItem(it._k, "material_type", it.material_type === 'pha' ? null : 'pha')} />
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      it.material_type === 'pha' ? 'border-amber-500 bg-amber-500' : 'border-slate-300'
                    }`}>
                      {it.material_type === 'pha' && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 16 16"><path d="M13.485 1.431a1.473 1.473 0 0 1 2.104 2.062l-7.84 9.801a1.473 1.473 0 0 1-2.12.04L.431 8.138a1.473 1.473 0 0 1 2.084-2.083l4.111 4.112 6.82-8.69a.486.486 0 0 1 .04-.046z"/></svg>}
                    </span>
                    <span className="text-sm font-medium">Hàng pha</span>
                    <span className="text-xs text-slate-400">(tái chế)</span>
                  </label>
                  {it.material_type && editing && !fdis("items") && (
                    <button type="button" onClick={() => upItem(it._k, "material_type", null)}
                      className="text-xs text-slate-400 hover:text-slate-600 underline self-center">
                      Bỏ chọn
                    </button>
                  )}
                </div>
                {it.material_type === 'pha' && (
                  <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead>
                        <tr className="bg-slate-100/50 border-b border-slate-200 text-slate-600 font-semibold text-xs">
                          <th className="px-3 py-2.5 w-12 text-center uppercase tracking-wider">STT</th>
                          <th className="px-3 py-2.5 uppercase tracking-wider">Nguyên vật liệu</th>
                          <th className="px-3 py-2.5 w-32 uppercase tracking-wider">Tỷ lệ (%)</th>
                          {editing && !fdis("items") && <th className="px-3 py-2.5 w-10"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {(it.mix_ratio || []).map((r, i) => (
                          <tr key={i} className="border-b border-slate-100 last:border-0 bg-white">
                            <td className="px-3 py-2.5 text-center text-slate-500 font-medium">{i + 1}</td>
                            <td className="px-3 py-2.5">
                              {editing && !fdis("items") ? (
                                <SearchSelect
                                  options={lookups.products.filter(p => p.product_type === 'Nguyên vật liệu').map(p => ({ value: p.id, label: p.product_name + (p.product_code ? ` (${p.product_code})` : '') }))}
                                  value={r.material_id}
                                  onChange={(v) => {
                                    const newArr = [...(it.mix_ratio || [])];
                                    newArr[i] = { ...newArr[i], material_id: v };
                                    upItem(it._k, "mix_ratio", newArr);
                                  }}
                                  placeholder="Chọn..."
                                  className="w-full rounded border-slate-300 text-sm py-1.5 px-2"
                                />
                              ) : (
                                <span className="font-medium text-slate-700">{lookups.products.find(p => p.id === r.material_id)?.product_name || "—"}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              {editing && !fdis("items") ? (
                                <input
                                  type="number"
                                  className={inputCls}
                                  value={r.ratio}
                                  onChange={(e) => {
                                    const newArr = [...(it.mix_ratio || [])];
                                    newArr[i] = { ...newArr[i], ratio: e.target.value };
                                    upItem(it._k, "mix_ratio", newArr);
                                  }}
                                  placeholder="%"
                                />
                              ) : (
                                <span className="font-medium">{r.ratio}%</span>
                              )}
                            </td>
                            {editing && !fdis("items") && (
                              <td className="px-3 py-2.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newArr = [...(it.mix_ratio || [])];
                                    newArr.splice(i, 1);
                                    upItem(it._k, "mix_ratio", newArr);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {editing && !fdis("items") && (
                      <div className="p-3 border-t border-slate-100 bg-white flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => upItem(it._k, "mix_ratio", [...(it.mix_ratio || []), { material_id: "", ratio: "" }])}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 px-2 py-1 hover:bg-blue-50 rounded transition-colors"
                        >
                          <Plus size={14} /> THÊM NGUYÊN VẬT LIỆU
                        </button>
                        {(() => {
                          const total = (it.mix_ratio || []).reduce((acc, curr) => acc + (Number(curr.ratio) || 0), 0);
                          return total > 0 && total !== 100 ? (
                            <span className="text-xs font-medium text-amber-600 flex items-center gap-1.5 bg-amber-50 px-2 py-1 rounded">
                              <AlertCircle size={14} /> Tổng tỷ lệ đang là {total}% (khác 100%)
                            </span>
                          ) : null;
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="pl-8">
                <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Tiến độ</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <label>
                    <span className="block text-xs font-medium text-slate-500 mb-1">Bắt đầu dự kiến</span>
                    <input type="date" className={inputCls} disabled={fdis("items")} value={it.planned_start_date || ""}
                      onChange={(e) => upItem(it._k, "planned_start_date", e.target.value)} />
                  </label>
                  <label>
                    <span className="block text-xs font-medium text-slate-500 mb-1">Kết thúc dự kiến</span>
                    <input type="date" className={inputCls} disabled={fdis("items")} value={it.planned_end_date || ""}
                      onChange={(e) => upItem(it._k, "planned_end_date", e.target.value)} />
                  </label>
                  <div>
                    <span className="block text-xs font-medium text-slate-500 mb-1">Bắt đầu thực tế</span>
                    <div className={inputCls + " bg-slate-100 text-slate-600"}>{it.actual_start_date ? fmtDateTime(it.actual_start_date) : "—"}</div>
                  </div>
                  <div>
                    <span className="block text-xs font-medium text-slate-500 mb-1">Kết thúc thực tế</span>
                    <div className={inputCls + " bg-slate-100 text-slate-600"}>{it.actual_end_date ? fmtDateTime(it.actual_end_date) : "—"}</div>
                  </div>
                </div>
              </div>
              <div className="pl-8">
                <span className="block text-xs font-medium text-slate-500 mb-1">Ghi chú</span>
                <textarea rows={2} className={inputCls + " resize-y"} disabled={fdis("items")} value={it.note || ""}
                  placeholder="Ghi chú riêng cho dòng hàng (vd: cho tẩy thêm, pha 8-2…)"
                  onChange={(e) => upItem(it._k, "note", e.target.value)} />
              </div>
              {editId && <LsxLinks orders={it.production_orders} onOpenProductionOrder={onOpenProductionOrder} />}
            </div>
          ))}
          {showMoney && (
            <div className="flex justify-end items-baseline gap-6 pt-3 border-t border-slate-200">
              <div className="flex items-baseline gap-2">
                <span className="text-sm text-slate-500">Tổng trước VAT:</span>
                <span className="text-base font-semibold text-slate-700">
                  {fmt(items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0), 0))} đ
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm text-slate-500">Tổng sau VAT (8%):</span>
                <span className="text-lg font-bold text-blue-700">
                  {fmt(items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0) * 1.08, 0))} đ
                </span>
              </div>
            </div>
          )}
        </div>
      </Section>
      )}
      </fieldset>
      {allocating && (
        <QuickAllocateModal
          orderId={editId}
          orderItems={items}
          lookups={lookups}
          onClose={() => setAllocating(false)}
          onDone={() => { setAllocating(false); loadData(); }}
        />
      )}
    </div>
  );
}

/* ---- Phiếu đặt hàng (in được) ---- */
function OrderVoucher({ id, onBack }) {
  const { fpermSecret } = usePerm();
  const showMoney = fpermSecret("orders", "amounts") !== "hidden";
  const [o, setO] = useState(null);
  useEffect(() => { ordersApi.get(id).then(setO).catch((e) => toast.error("Lỗi: " + e.message)); }, [id]);
  if (!o) return <div className="text-slate-400 text-sm py-10">Đang tải phiếu…</div>;
  const totalQty = (o.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
  const totalAmount = (o.items || []).reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between no-print">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm"><ArrowLeft size={18} /> Quay lại</button>
        <button onClick={() => window.print()} className="btn-primary"><Printer size={16} /> In phiếu</button>
      </div>

      <div className="print-area bg-white rounded-xl border border-slate-200 p-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-4 border-b-2 border-blue-700 pb-3 mb-4">
          <Logo className="h-14 w-auto shrink-0" />
          <div className="flex-1 text-center">
            <div className="text-sm font-semibold text-slate-700">CÔNG TY TNHH THƯƠNG MẠI SẢN XUẤT XNK BAO BÌ NGỌC AN THƯ</div>
            <h2 className="text-xl font-bold text-slate-900 mt-2 uppercase">Phiếu đặt hàng</h2>
            <div className="text-sm text-slate-600 mt-0.5">Số: <b>{o.order_code}</b></div>
          </div>
          <div className="w-14 shrink-0" />
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm mb-5">
          <div><span className="text-slate-500">Khách hàng:</span> <b>{o.customer_name}</b></div>
          <div><span className="text-slate-500">Điện thoại:</span> {o.customer_phone || "—"}</div>
          <div className="col-span-2"><span className="text-slate-500">Địa chỉ:</span> {o.customer_address || "—"}</div>
          <div><span className="text-slate-500">Ngày đặt:</span> {fmtDate(o.order_date)}</div>
          <div><span className="text-slate-500">Ngày giao:</span> {fmtDate(o.due_date)}</div>
          <div><span className="text-slate-500">Trạng thái:</span> {o.status}</div>
        </div>

        <table className="w-full text-sm border border-slate-300 border-collapse">
          <thead className="bg-slate-100">
            <tr>
              {["STT", "Sản phẩm", "Thông số kỹ thuật", "SL", "ĐVT", ...(showMoney ? ["Đơn giá", "Thành tiền"] : [])].map((h) =>
                <th key={h} className="border border-slate-300 px-2 py-1.5 text-left">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {o.items.map((it, i) => (
              <tr key={it.id}>
                <td className="border border-slate-300 px-2 py-1.5 text-center">{i + 1}</td>
                <td className="border border-slate-300 px-2 py-1.5">
                  {it.product_name}
                  {(it.core_weight != null || it.total_weight != null) && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      {it.core_weight != null && <>Lõi: {fmt(it.core_weight)} kg</>}
                      {it.total_weight != null && <> · Tổng KL: {fmt(it.total_weight)} kg</>}
                    </div>
                  )}
                  {it.note && <div className="text-xs text-slate-500 italic mt-0.5 whitespace-pre-line">{it.note}</div>}
                </td>
                <td className="border border-slate-300 px-2 py-1.5">{specShort(it.specs) || "—"}</td>
                <td className="border border-slate-300 px-2 py-1.5 text-right">{fmt(it.quantity)}</td>
                <td className="border border-slate-300 px-2 py-1.5">{it.unit}</td>
                {showMoney && <>
                  <td className="border border-slate-300 px-2 py-1.5 text-right">{fmt(it.unit_price || 0)}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right">{fmt((Number(it.unit_price) || 0) * (Number(it.quantity) || 0))}</td>
                </>}
              </tr>
            ))}
            <tr className="font-semibold bg-slate-50">
              <td colSpan={3} className="border border-slate-300 px-2 py-1.5 text-right">Tổng số lượng</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">{fmt(totalQty)}</td>
              <td className="border border-slate-300 px-2 py-1.5" />
              {showMoney && <><td className="border border-slate-300 px-2 py-1.5" /><td className="border border-slate-300 px-2 py-1.5" /></>}
            </tr>
            {showMoney && (
              <tr className="font-bold bg-blue-50">
                <td colSpan={6} className="border border-slate-300 px-2 py-1.5 text-right">Tổng tiền</td>
                <td className="border border-slate-300 px-2 py-1.5 text-right">{fmt(o.total_amount ?? totalAmount)} đ</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-4 mt-10 text-center text-sm">
          <div><div className="font-medium">Người lập phiếu</div><div className="text-slate-400 text-xs">(Ký, ghi rõ họ tên)</div></div>
          <div><div className="font-medium">Khách hàng</div><div className="text-slate-400 text-xs">(Ký, ghi rõ họ tên)</div></div>
        </div>
      </div>

      <style>{`@media print {
        body * { visibility: hidden !important; }
        .print-area, .print-area * { visibility: visible !important; }
        .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; }
        .no-print { display: none !important; }
      }`}</style>
    </div>
  );
}

/* ---- Module chính ---- */
function ExcelImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: Select File, 2: Preview, 3: Result
  const [previewData, setPreviewData] = useState([]);
  const [result, setResult] = useState(null);

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      let allRows = [];
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const sheetRows = rawData.filter((r) => r[0] !== '' && r[0] !== 'Ngày đặt hàng' && r[1]);
        sheetRows.forEach(r => { r.sheetName = sheetName; });
        allRows = allRows.concat(sheetRows);
      }
      
      let allPreview = [];
      const chunkSize = 100;
      for (let i = 0; i < allRows.length; i += chunkSize) {
        const chunk = allRows.slice(i, i + chunkSize);
        const res = await salesOrdersApi.previewExcel(chunk);
        allPreview = allPreview.concat(res.preview || []);
      }
      
      setPreviewData(allPreview);
      setStep(2);
    } catch (e) {
      toast.error('Lỗi đọc file: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    const validRows = previewData.filter(d => d.isValid);
    if (validRows.length === 0) return;
    setLoading(true);
    let totalSuccess = 0;
    let totalErrors = 0;
    let allDetails = [];
    try {
      const chunkSize = 50;
      for (let i = 0; i < validRows.length; i += chunkSize) {
        const chunk = validRows.slice(i, i + chunkSize);
        const res = await salesOrdersApi.confirmExcel(chunk);
        if (res.summary) {
          totalSuccess += res.summary.success || 0;
          totalErrors += res.summary.errors || 0;
        }
        if (res.details) {
          allDetails = allDetails.concat(res.details);
        }
      }
      setResult({
        summary: { success: totalSuccess, errors: totalErrors },
        details: allDetails
      });
      setStep(3);
      onDone();
    } catch (e) {
      toast.error('Lỗi import: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const removeRow = (index) => {
    setPreviewData(prev => prev.filter((_, i) => i !== index));
  };

  const removeAllErrors = () => {
    setPreviewData(prev => prev.filter(row => row.isValid));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[90vh] ${step === 2 ? 'max-w-6xl' : 'max-w-lg'}`}>
        <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
              <Upload size={18} />
            </div>
            <div>
              <p className="font-bold text-slate-800">
                {step === 1 && "Nhập đơn hàng từ Excel"}
                {step === 2 && "Kiểm tra dữ liệu trước khi nhập"}
                {step === 3 && "Kết quả nhập dữ liệu"}
              </p>
              {step === 1 && <p className="text-xs text-slate-400">Định dạng: Ngày, Khách, Kích thước, KG PO, KG cuộn, KG túi, Phế, Ghi chú</p>}
              {step === 2 && <p className="text-xs text-slate-400">Vui lòng kiểm tra và loại bỏ các dòng bị lỗi</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto min-h-0">
          {step === 1 && (
            <>
              <label className="block">
                <div className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  file ? 'border-green-400 bg-green-50' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50'
                }`}>
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  {file ? (
                    <><CheckCircle className="mx-auto mb-2 text-green-500" size={28} />
                    <p className="font-medium text-green-700">{file.name}</p>
                    <p className="text-xs text-green-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p></>
                  ) : (
                    <><Upload className="mx-auto mb-2 text-slate-400" size={28} />
                    <p className="text-slate-500">Kéo thả hoặc click để chọn file Excel</p>
                    <p className="text-xs text-slate-400 mt-1">.xlsx / .xls</p></>
                  )}
                </div>
              </label>
              <div className="flex gap-3 justify-end">
                <button onClick={onClose} className="btn-ghost">Hủy</button>
                <button onClick={handlePreview} disabled={!file || loading} className="btn-primary disabled:opacity-50">
                  {loading ? 'Đang đọc...' : 'Tiếp tục'}
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <div className="flex flex-col h-full gap-4">
              <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div className="text-sm font-medium text-slate-700">
                  Tổng cộng: <span className="font-bold">{previewData.length}</span> dòng | 
                  Hợp lệ: <span className="font-bold text-green-600 ml-1">{previewData.filter(d => d.isValid).length}</span> |
                  Lỗi: <span className="font-bold text-rose-600 ml-1">{previewData.filter(d => !d.isValid).length}</span>
                </div>
                {previewData.filter(d => !d.isValid).length > 0 && (
                  <button onClick={removeAllErrors} className="flex items-center gap-1.5 text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg hover:bg-rose-100 transition">
                    <Trash2 size={14} /> Xóa tất cả dòng lỗi
                  </button>
                )}
              </div>
              
              <div className="border border-slate-200 rounded-lg overflow-hidden flex-1 relative min-h-[300px]">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase sticky top-0 shadow-sm z-10">
                    <tr>
                      <th className="px-3 py-2">TT</th>
                      <th className="px-3 py-2">Sheet</th>
                      <th className="px-3 py-2">Khách hàng</th>
                      <th className="px-3 py-2">Ngày đặt</th>
                      <th className="px-3 py-2">Ngày giao</th>
                      <th className="px-3 py-2">Kích thước</th>
                      <th className="px-3 py-2">SL (KG PO)</th>
                      <th className="px-3 py-2">Ghi chú</th>
                      <th className="px-3 py-2">Trạng thái</th>
                      <th className="px-3 py-2 text-center w-12">Xóa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewData.length === 0 ? (
                      <tr><td colSpan="8" className="text-center py-8 text-slate-500 italic">Không có dữ liệu</td></tr>
                    ) : previewData.map((row, i) => (
                      <tr key={i} className={!row.isValid ? "bg-rose-50/50" : (row.warnings?.length > 0 ? "bg-amber-50/50" : "hover:bg-slate-50")}>
                        <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 text-slate-500 font-medium text-xs">{row.sheetName}</td>
                        <td className="px-3 py-2 font-medium">{row.customerName || <span className="text-rose-500 italic">Trống</span>}</td>
                        <td className="px-3 py-2">{fmtDate(row.orderDate)}</td>
                        <td className="px-3 py-2 text-slate-500">{row.dueDate ? fmtDate(row.dueDate) : '_'}</td>
                        <td className="px-3 py-2">{row.dimStr}</td>
                        <td className="px-3 py-2 font-medium text-slate-700">{row.kgPO}</td>
                        <td className="px-3 py-2 max-w-[150px] truncate" title={row.ghiChu}>{row.ghiChu}</td>
                        <td className="px-3 py-2 text-xs">
                          {!row.isValid ? (
                            <div className="text-rose-600 flex items-start gap-1">
                              <AlertCircle size={14} className="mt-0.5 shrink-0" />
                              <ul className="list-disc pl-3">{row.errors.map((e, idx) => <li key={idx}>{e}</li>)}</ul>
                            </div>
                          ) : row.warnings?.length > 0 ? (
                            <div className="text-amber-600">{row.warnings.join(', ')}</div>
                          ) : (
                            <div className="text-green-600 flex items-center gap-1"><CheckCircle size={14} /> Hợp lệ</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => removeRow(i)} className="text-slate-400 hover:text-rose-500 p-1.5 rounded-md hover:bg-rose-50 transition" title="Xóa dòng này">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setStep(1)} className="btn-ghost" disabled={loading}>Quay lại</button>
                <button onClick={handleConfirm} disabled={previewData.length === 0 || loading || previewData.some(d => !d.isValid)} className="btn-primary disabled:opacity-50">
                  {loading ? 'Đang nhập...' : <><Save size={16} /> Xác nhận nhập ({previewData.length})</>}
                </button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <>
              <div className="grid grid-cols-2 gap-3 text-center mb-6">
                <div className="bg-green-50 rounded-xl p-4">
                  <p className="text-3xl font-bold text-green-600">{result.summary?.success ?? 0}</p>
                  <p className="text-sm font-medium text-green-700 mt-1">Thành công</p>
                </div>
                <div className="bg-rose-50 rounded-xl p-4">
                  <p className="text-3xl font-bold text-rose-600">{result.summary?.errors ?? 0}</p>
                  <p className="text-sm font-medium text-rose-700 mt-1">Lỗi</p>
                </div>
              </div>
              
              {result.details?.filter(d => d.error).length > 0 && (
                <div>
                  <h4 className="font-semibold text-rose-700 mb-2 flex items-center gap-1.5"><AlertCircle size={16}/> Chi tiết lỗi:</h4>
                  <div className="max-h-48 overflow-y-auto text-xs space-y-1 bg-rose-50/50 p-3 rounded-lg border border-rose-100">
                    {result.details.filter(d => d.error).map((d, i) => (
                      <div key={i} className="text-rose-700 font-medium">
                        Dòng {d.row}: <span className="font-normal">{d.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={onClose} className="btn-primary w-full">Đóng</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OrdersModule({ lookups, focusId, onFocusConsumed, onCreateDelivery, onOpenProductionOrder }) {
  const { can, fpermSecret } = usePerm();
  const showMoney = fpermSecret("orders", "amounts") !== "hidden";
  const [view, setView] = useState("list");
  const [editId, setEditId] = useState(null);
  const [copyId, setCopyId] = useState(null);
  const [voucherId, setVoucherId] = useState(null);
  const [rows, setRows] = useState([]);
  const [showImport, setShowImport] = useState(false);
  const openForm = ({ edit = null, copy = null } = {}) => { setEditId(edit); setCopyId(copy); setView("form"); };

  const load = useCallback(async () => {
    try { setRows(await ordersApi.list({})); } catch (e) { toast.error("Lỗi tải đơn hàng: " + e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Mở sẵn chi tiết đơn khi được điều hướng từ màn khác (vd: Khách hàng)
  useEffect(() => {
    if (focusId) { setEditId(focusId); setView("form"); onFocusConsumed?.(); }
  }, [focusId]);

  const del = async (id) => { if (!confirm("Xóa đơn hàng này?")) return; try { await ordersApi.remove(id); toast.success("Đã xóa thành công"); load(); } catch (e) { toast.error("Lỗi xóa: " + e.message); } };

  const columns = [
    { key: "order_code", label: "Mã đơn", filter: "text", minWidth: "130px", render: (r) => <button onClick={() => openForm({ edit: r.id })} className="font-medium text-blue-600 hover:underline">{r.order_code}</button> },
    { key: "customer_name", label: "Khách hàng", filter: "select", minWidth: "200px", tdClass: "text-slate-800" },
    { key: "order_date", label: "Ngày đặt", filter: "date", minWidth: "130px", render: (r) => fmtDate(r.order_date) },
    { key: "due_date", label: "Ngày giao", filter: "date", minWidth: "130px", render: (r) => {
        const done = ["Hoàn thành", "Đã hủy"].includes(r.status);
        const tone = dueTone(r.due_date);
        return <span className={`inline-flex items-center gap-1.5 ${done ? "text-slate-500" : tone.text}`}>
          {!done && r.due_date && <span className={`w-2 h-2 rounded-full ${tone.dot}`} title={tone.label} />}{fmtDate(r.due_date)}</span>;
      } },
    { key: "item_count", label: "Số dòng", align: "center", minWidth: "80px" },
    { key: "total_qty", label: "Tổng SL", align: "right", minWidth: "100px", render: (r) => fmt(r.total_qty) },
    ...(showMoney ? [{ key: "total_amount", label: "Giá trị đơn", align: "right", minWidth: "120px", render: (r) => <span className="font-medium text-slate-700">{fmt(r.total_amount || 0)} đ</span> }] : []),
    { key: "priority", label: "Ưu tiên", filter: "select", minWidth: "120px", options: ["Cao", "Trung bình", "Thấp"], render: (r) => {
        if (r.priority === 'Cao') return <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-700 whitespace-nowrap">Cao</span>;
        if (r.priority === 'Thấp') return <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500 whitespace-nowrap">Thấp</span>;
        return <span className="text-slate-500 text-sm whitespace-nowrap">Trung bình</span>;
      } },
    { key: "status", label: "Trạng thái", filter: "select", minWidth: "160px", render: (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span> },
    { key: "_act", label: "", align: "right", render: (r) => (<>
        <button onClick={() => { setVoucherId(r.id); setView("voucher"); }} title="Xem phiếu" className="text-slate-400 hover:text-emerald-600 p-1"><FileText size={15} /></button>
        {can("orders", "create") && <button onClick={() => openForm({ copy: r.id })} title="Sao chép thành đơn mới" className="text-slate-400 hover:text-blue-600 p-1"><Copy size={15} /></button>}
        {can("orders", "edit") && <button onClick={() => openForm({ edit: r.id })} title="Sửa" className="text-slate-400 hover:text-blue-600 p-1"><Pencil size={15} /></button>}
        {can("orders", "delete") && <button onClick={() => del(r.id)} title="Xóa" className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={15} /></button>}
      </>) },
  ];

  return (
    <>
      <div className={view === "list" ? "space-y-5" : "hidden"}>
        {showImport && <ExcelImportModal onClose={() => setShowImport(false)} onDone={() => { load(); }} />}
        <ListHeader title="Đơn hàng" actions={<>
          <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
          {can("orders", "create") && (
            <button onClick={() => setShowImport(true)} className="btn-ghost border border-green-300 text-green-700 hover:bg-green-50">
              <Upload size={16} /> Nhập Excel
            </button>
          )}
          {can("orders", "create") && <button onClick={() => openForm({})} className="btn-primary"><Plus size={16} /> Tạo đơn hàng</button>}
        </>} />
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Chưa có đơn hàng" />
      </div>

      {view === "form" && (
        <OrderForm lookups={lookups} editId={editId} copyId={copyId}
          onBack={() => { setView("list"); setEditId(null); setCopyId(null); load(); }} 
          onSaved={() => { setView("list"); setEditId(null); setCopyId(null); load(); }}
          onPrint={(id) => { setVoucherId(id); setView("voucher"); }} 
          onCreateDelivery={onCreateDelivery} 
          onOpenProductionOrder={onOpenProductionOrder} 
        />
      )}
      
      {view === "voucher" && <OrderVoucher id={voucherId} onBack={() => setView("list")} />}
    </>
  );
}
