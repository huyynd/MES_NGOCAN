import React, { useState, useEffect, useCallback } from "react";
import { Wrench, Save, RefreshCcw, History, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { DataTable, PageHeader, UnitSelect } from "../../components.jsx";
import { inventory } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import { inputCls, fmt, toast } from "../../ui.js";

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
  </div>
);

const ADJUST_REASONS = [
  "Kiểm kê định kỳ", "Hàng hư hỏng / hết hạn", "Hàng thất lạc", "Nhập thừa / xuất thiếu",
  "Chuyển đổi đơn vị", "Điều chỉnh ban đầu", "Lý do khác"
];

function AdjustForm({ lookups, onSaved }) {
  const [form, setForm] = useState({
    product_id: "", system_qty: null, actual_qty: "", unit: "",
    location_id: "", lot_code: "", reason: "Kiểm kê định kỳ", note: ""
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const onProductChange = async (id) => {
    const p = (lookups.products || []).find(x => x.id === id);
    set("product_id", id);
    if (p) set("unit", p.unit || "");
    set("system_qty", null);
    if (id) {
      try {
        const tree = await inventory.tree({ product_id: id });
        // tree trả về mảng phẳng — cộng dồn quantity của tất cả dòng thuộc sản phẩm này
        const total = (tree || []).filter(x => x.product_id === id).reduce((s, r) => s + Number(r.quantity || 0), 0);
        setForm(s => ({ ...s, product_id: id, system_qty: total, unit: p?.unit || s.unit }));
      } catch { /* ignore */ }
    }
  };

  const delta = form.system_qty !== null && form.actual_qty !== ""
    ? Number(form.actual_qty) - Number(form.system_qty)
    : null;

  const save = async () => {
    if (!form.product_id) return toast.error("Chọn sản phẩm cần điều chỉnh");
    if (!form.location_id) return toast.error("Chọn kho / vị trí cần điều chỉnh");
    if (form.actual_qty === "" || Number(form.actual_qty) < 0) return toast.error("Nhập số lượng thực tế (≥ 0)");
    if (delta === 0) return toast.error("Số lượng thực tế bằng hệ thống, không cần điều chỉnh");

    setSaving(true);
    try {
      // Ghi 1 giao dịch Điều chỉnh với delta (âm hoặc dương)
      await inventory.adjust({
        product_id: form.product_id,
        quantity: Math.abs(delta),
        unit: form.unit,
        location_id: form.location_id || null,
        lot_code: form.lot_code || "",
        trx_type: delta > 0 ? "Nhập" : "Xuất",
        ref_code: null,
        note: `[Điều chỉnh] ${form.reason}${form.note ? " – " + form.note : ""} (HT: ${fmt(form.system_qty)} → TT: ${fmt(form.actual_qty)})`,
      });
      toast.success(`Đã điều chỉnh tồn kho thành công! (${delta > 0 ? "+" : ""}${fmt(delta)} ${form.unit})`);
      setForm({
        product_id: "", system_qty: null, actual_qty: "", unit: "",
        location_id: "", lot_code: "", reason: "Kiểm kê định kỳ", note: ""
      });
      onSaved();
    } catch (e) {
      toast.error("Lỗi điều chỉnh: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 bg-amber-50 border-b border-amber-100 flex items-center gap-3">
        <Wrench size={20} className="text-amber-600" />
        <h3 className="font-semibold text-amber-800">Điều chỉnh tồn kho</h3>
        <span className="text-amber-600 text-sm ml-1">· Dùng khi có chênh lệch giữa hệ thống và thực tế</span>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Sản phẩm" required>
            <select className={inputCls} value={form.product_id} onChange={e => onProductChange(e.target.value)}>
              <option value="">-- Chọn sản phẩm --</option>
              {(lookups.products || []).map(p => (
                <option key={p.id} value={p.id}>{p.product_code} · {p.product_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Kho / Vị trí">
            <select className={inputCls} value={form.location_id} onChange={e => set("location_id", e.target.value)}>
              <option value="">-- Tất cả vị trí --</option>
              {(lookups.locations || []).map(l => (
                <option key={l.id} value={l.id}>{l.warehouse_name} · {l.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Số lô">
            <input className={inputCls} placeholder="Mã lô (nếu có)" value={form.lot_code}
              onChange={e => set("lot_code", e.target.value)} />
          </Field>
        </div>

        {/* Stock comparison panel */}
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-3">So sánh tồn kho</div>
          <div className="grid grid-cols-3 gap-4 items-end">
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1.5">Tồn kho Hệ thống</div>
              <div className={`text-3xl font-bold ${form.system_qty !== null ? "text-slate-700" : "text-slate-300"}`}>
                {form.system_qty !== null ? fmt(form.system_qty) : "—"}
              </div>
              <div className="text-xs text-slate-400 mt-1">{form.unit}</div>
            </div>
            <div className="flex flex-col items-center gap-2">
              {delta === null ? (
                <Minus size={24} className="text-slate-300" />
              ) : delta > 0 ? (
                <TrendingUp size={24} className="text-emerald-500" />
              ) : delta < 0 ? (
                <TrendingDown size={24} className="text-rose-500" />
              ) : (
                <Minus size={24} className="text-slate-400" />
              )}
              {delta !== null && delta !== 0 && (
                <span className={`text-lg font-bold ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {delta > 0 ? "+" : ""}{fmt(delta)} {form.unit}
                </span>
              )}
              {delta === 0 && <span className="text-slate-400 text-sm">Không chênh lệch</span>}
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500 mb-1.5">Tồn kho Thực tế (nhập)</div>
              <input
                type="number" min="0" step="any"
                className={`text-center text-3xl font-bold border-b-2 bg-transparent outline-none w-full pb-1 ${
                  delta === null ? "border-slate-300 text-slate-400" :
                  delta > 0 ? "border-emerald-400 text-emerald-700" :
                  delta < 0 ? "border-rose-400 text-rose-700" : "border-slate-300 text-slate-700"
                }`}
                placeholder="0"
                value={form.actual_qty}
                onChange={e => set("actual_qty", e.target.value)}
              />
              <div className="text-xs text-slate-400 mt-1">{form.unit}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Lý do điều chỉnh" required>
            <select className={inputCls} value={form.reason} onChange={e => set("reason", e.target.value)}>
              {ADJUST_REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Đơn vị">
              <UnitSelect value={form.unit} onChange={v => set("unit", v)} />
            </Field>
          </div>
        </div>

        <Field label="Ghi chú chi tiết">
          <input className={inputCls} placeholder="Mô tả thêm lý do điều chỉnh…" value={form.note}
            onChange={e => set("note", e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={save} disabled={saving || delta === 0} className="btn-primary flex items-center gap-2">
            <Save size={16} /> {saving ? "Đang lưu…" : "Xác nhận điều chỉnh"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjustHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await inventory.transactions({});
      setRows((all || []).filter(r => (r.note || "").startsWith("[Điều chỉnh]")));
    } catch (e) { toast.error("Lỗi: " + e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const TRX_COLOR = { "Nhập": "bg-emerald-50 text-emerald-700", "Xuất": "bg-rose-50 text-rose-700" };
  const columns = [
    { key: "created_at", label: "Thời gian", render: r => new Date(r.created_at).toLocaleString("vi-VN") },
    { key: "trx_type", label: "Hướng", render: r => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${TRX_COLOR[r.trx_type] || ""}`}>{r.trx_type === "Nhập" ? "Tăng +" : "Giảm −"}</span> },
    { key: "product_code", label: "Mã SP", filter: "text", tdClass: "font-medium text-blue-600" },
    { key: "product_name", label: "Sản phẩm", filter: "select" },
    { key: "quantity", label: "Chênh lệch", align: "right", render: r => <span className={`font-semibold ${r.trx_type === "Nhập" ? "text-emerald-600" : "text-rose-600"}`}>{r.trx_type === "Nhập" ? "+" : "−"}{fmt(r.quantity)}</span> },
    { key: "warehouse_name", label: "Kho/Vị trí", render: r => r.warehouse_name ? `${r.warehouse_name}${r.location_name ? " · " + r.location_name : ""}` : "—" },
    { key: "note", label: "Lý do / Chi tiết", tdClass: "text-slate-500 text-xs" },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-slate-700">
          <History size={16} /> Lịch sử điều chỉnh
        </div>
        <button onClick={load} className="btn-ghost text-sm flex items-center gap-1.5">
          <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Làm mới
        </button>
      </div>
      <div className="p-4">
        <DataTable dense columns={columns} rows={rows} rowKey={r => r.id}
          emptyText={loading ? "Đang tải…" : "Chưa có lần điều chỉnh nào"} />
      </div>
    </div>
  );
}

export default function AdjustModule({ lookups }) {
  const { can } = usePerm();
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-6">
      <PageHeader title="Điều chỉnh tồn kho" icon={Wrench} />
      {(can("inv_adjust", "create") || can("inv_adjust", "edit")) && (
        <AdjustForm lookups={lookups} onSaved={() => setRefreshKey(k => k + 1)} />
      )}
      {can("inv_adjust", "view") && (
        <AdjustHistory key={refreshKey} />
      )}
    </div>
  );
}
