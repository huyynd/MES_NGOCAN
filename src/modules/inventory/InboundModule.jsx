import React, { useState, useEffect, useCallback } from "react";
import { PackagePlus, Save, Plus, Trash2, RefreshCcw, FileText, History } from "lucide-react";
import { ListHeader, DataTable, PageHeader, Section, UnitSelect, SearchSelect } from "../../components.jsx";
import { inventory } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import { inputCls, fmt, fmtDate, statusClass, toast, todayYmd } from "../../ui.js";

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
  </div>
);

const INBOUND_SOURCES = ["Mua hàng NCC", "Sản xuất hoàn thành", "Trả hàng từ khách", "Chuyển kho", "Khác"];

const emptyLine = () => ({
  _k: Math.random(), product_id: "", quantity: "", unit: "", lot_code: "", note: ""
});

function InboundForm({ lookups, onSaved }) {
  const [header, setHeader] = useState({
    ref_code: "", inbound_date: todayYmd(),
    location_id: "", source: "Mua hàng NCC", note: ""
  });
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(false);

  const setH = (k, v) => setHeader(s => ({ ...s, [k]: v }));
  const setLine = (k, field, v) => setLines(a => a.map(l => l._k === k ? { ...l, [field]: v } : l));
  const onProductChange = (k, id) => {
    const p = (lookups.products || []).find(x => x.id === id);
    setLines(a => a.map(l => l._k === k ? { ...l, product_id: id, unit: p?.unit || "" } : l));
  };
  const addLine = () => setLines(a => [...a, emptyLine()]);
  const rmLine = (k) => setLines(a => a.filter(l => l._k !== k));

  const save = async () => {
    if (!header.location_id) return toast.error("Chọn kho / vị trí nhập hàng");
    const validLines = lines.filter(l => l.product_id && Number(l.quantity) > 0);
    if (!validLines.length) return toast.error("Nhập ít nhất 1 sản phẩm với số lượng > 0");
    setSaving(true);
    const finalRef = header.ref_code.trim() || `NK${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}`;
    try {
      await Promise.all(validLines.map((l, idx) => {
        const finalLot = (l.lot_code || "").trim() || `LO${new Date().toISOString().replace(/\D/g, '').slice(2, 12)}${String(idx + 1).padStart(2, '0')}`;
        return inventory.adjust({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit: l.unit,
          location_id: header.location_id,
          lot_code: finalLot,
          trx_type: "Nhập",
          ref_code: finalRef,
          note: [header.source, header.note, l.note].filter(Boolean).join(" | "),
        });
      }));
      toast.success(`Đã nhập kho ${validLines.length} dòng sản phẩm thành công!`);
      setLines([emptyLine()]);
      setHeader(h => ({ ...h, ref_code: "" }));
      onSaved();
    } catch (e) {
      toast.error("Lỗi: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-100 flex items-center gap-3">
        <PackagePlus size={20} className="text-emerald-600" />
        <h3 className="font-semibold text-emerald-800">Tạo phiếu nhập kho</h3>
      </div>

      <div className="p-5 space-y-5">
        {/* Header info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Số phiếu">
            <input className={inputCls} placeholder="Tự động nếu trống" value={header.ref_code}
              onChange={e => setH("ref_code", e.target.value)} />
          </Field>
          <Field label="Ngày nhập" required>
            <input type="date" className={inputCls} value={header.inbound_date}
              onChange={e => setH("inbound_date", e.target.value)} />
          </Field>
          <Field label="Nguồn nhập" required>
            <select className={inputCls} value={header.source} onChange={e => setH("source", e.target.value)}>
              {INBOUND_SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Kho / Vị trí nhập" required>
            <select className={inputCls} value={header.location_id} onChange={e => setH("location_id", e.target.value)}>
              <option value="">-- Chọn kho/vị trí --</option>
              {(lookups.locations || []).map(l => (
                <option key={l.id} value={l.id}>{l.warehouse_name} · {l.name}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* Lines table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700">Danh sách hàng nhập</span>
            <button onClick={addLine} className="btn-ghost text-sm flex items-center gap-1.5">
              <Plus size={14} /> Thêm dòng
            </button>
          </div>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <th className="px-3 py-2.5 text-left">Sản phẩm *</th>
                  <th className="px-3 py-2.5 text-right w-28">Số lượng *</th>
                  <th className="px-3 py-2.5 w-24">Đơn vị</th>
                  <th className="px-3 py-2.5 w-32">Số lô</th>
                  <th className="px-3 py-2.5">Ghi chú dòng</th>
                  <th className="px-3 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map(l => (
                  <tr key={l._k} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2">
                      <SearchSelect
                        value={l.product_id}
                        onChange={v => onProductChange(l._k, v)}
                        options={(lookups.products || []).map(p => ({ value: p.id, label: `${p.product_code} · ${p.product_name}` }))}
                        placeholder="-- Chọn sản phẩm --"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" className={inputCls + " text-right"} value={l.quantity}
                        onChange={e => setLine(l._k, "quantity", e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <UnitSelect value={l.unit} onChange={v => setLine(l._k, "unit", v)} />
                    </td>
                    <td className="px-3 py-2">
                      <input className={inputCls} placeholder="VD: L001" value={l.lot_code}
                        onChange={e => setLine(l._k, "lot_code", e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <input className={inputCls} placeholder="Ghi chú…" value={l.note}
                        onChange={e => setLine(l._k, "note", e.target.value)} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {lines.length > 1 && (
                        <button onClick={() => rmLine(l._k)} className="text-slate-300 hover:text-rose-500 transition">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <Field label="Ghi chú phiếu">
          <input className={inputCls} placeholder="Ghi chú chung cho phiếu nhập…" value={header.note}
            onChange={e => setH("note", e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">
            <Save size={16} /> {saving ? "Đang lưu…" : "Xác nhận nhập kho"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TransactionHistory({ type }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await inventory.transactions({ trx_type: type })); }
    catch (e) { toast.error("Lỗi: " + e.message); }
    finally { setLoading(false); }
  }, [type]);
  useEffect(() => { load(); }, [load]);

  const TRX_COLOR = { "Nhập": "bg-emerald-50 text-emerald-700", "Xuất": "bg-rose-50 text-rose-700", "Điều chỉnh": "bg-amber-50 text-amber-700", "Chuyển": "bg-blue-50 text-blue-700" };
  const columns = [
    { key: "created_at", label: "Thời gian", render: r => new Date(r.created_at).toLocaleString("vi-VN") },
    { key: "trx_type", label: "Loại", render: r => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${TRX_COLOR[r.trx_type] || ""}`}>{r.trx_type}</span> },
    { key: "product_code", label: "Mã SP", filter: "text", tdClass: "font-medium text-blue-600" },
    { key: "product_name", label: "Sản phẩm", filter: "select" },
    { key: "quantity", label: "Số lượng", align: "right", render: r => <span className="font-semibold text-emerald-600">+{fmt(r.quantity)}</span> },
    { key: "warehouse_name", label: "Kho/Vị trí", render: r => r.warehouse_name ? `${r.warehouse_name}${r.location_name ? " · " + r.location_name : ""}` : "—" },
    { key: "lot_code", label: "Lô", render: r => r.lot_code || "—" },
    { key: "ref_code", label: "Số phiếu", filter: "text", render: r => r.ref_code || "—" },
    { key: "note", label: "Ghi chú", tdClass: "text-slate-400 text-xs" },
  ];
  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-slate-700">
          <History size={16} /> Lịch sử phiếu nhập
        </div>
        <button onClick={load} className="btn-ghost text-sm flex items-center gap-1.5">
          <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Làm mới
        </button>
      </div>
      <div className="p-4">
        <DataTable dense columns={columns} rows={rows} rowKey={r => r.id}
          emptyText={loading ? "Đang tải…" : "Chưa có phiếu nhập"} />
      </div>
    </div>
  );
}

export default function InboundModule({ lookups }) {
  const { can } = usePerm();
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-6">
      <PageHeader title="Nhập kho" icon={PackagePlus} />
      {(can("inv_inbound", "create") || can("inv_inbound", "edit")) && (
        <InboundForm lookups={lookups} onSaved={() => setRefreshKey(k => k + 1)} />
      )}
      {can("inv_inbound", "view") && (
        <TransactionHistory key={refreshKey} type="Nhập" />
      )}
    </div>
  );
}
