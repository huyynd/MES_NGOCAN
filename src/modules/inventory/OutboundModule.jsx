import React, { useState, useEffect, useCallback } from "react";
import { Upload, Save, Plus, Trash2, RefreshCcw, History, AlertTriangle, PackageCheck, Check, Ban, ChevronRight, ChevronDown, ClipboardList } from "lucide-react";
import { DataTable, PageHeader, UnitSelect, SearchSelect, useRemembered } from "../../components.jsx";
import { inventory } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import { inputCls, fmt, fmtDate, toast, todayYmd, fmtDateTime } from "../../ui.js";
import { defaultRange, TrxRange, byColumn } from "./trxHistory.jsx";

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
  </div>
);

const OUTBOUND_PURPOSES = ["Giao cho khách hàng", "Xuất cho sản xuất", "Xuất trả NCC", "Hủy / Phế liệu", "Khác"];
// K-04: "Chuyển kho" có màn riêng (trừ nguồn + cộng đích cùng lúc) — không xuất ở đây

const emptyLine = () => ({
  _k: Math.random(), product_id: "", quantity: "", unit: "", lot_code: "", spec_key: "", rows: null, note: ""
});

const specLabel = (k) => (String(k || "").split("|").filter(Boolean).join(" · ") || "Không thông số");
const newRef = () => `XK${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}${Math.floor(Math.random() * 90 + 10)}`;

// Tồn của 1 dòng phiếu tại vị trí xuất, tách theo thông số / lô (K-04/K-05: không gộp lẫn màu, kích thước)
function lineStock(l, locId) {
  if (!l.rows) return { available: null, specs: [], lots: [], spec: "", lot: "" };
  const locRows = l.rows.filter(r => Number(r.quantity) > 0 && (!locId || r.location_id === locId));
  const specs = [...new Set(locRows.map(r => r.spec_key))];
  const spec = l.spec_key || (specs.length === 1 ? specs[0] : "");
  const specRows = spec ? locRows.filter(r => r.spec_key === spec) : locRows;
  const lots = [...new Set(specRows.filter(r => r.lot_code).map(r => r.lot_code))];
  const lot = l.lot_code || (lots.length === 1 ? lots[0] : "");
  const available = (lot ? specRows.filter(r => r.lot_code === lot) : specRows).reduce((s, r) => s + Number(r.quantity || 0), 0);
  return { available, specs, lots, spec, lot };
}

function OutboundForm({ lookups, onSaved }) {
  const [header, setHeader] = useState({
    ref_code: "",
    location_id: "", purpose: "Giao cho khách hàng", note: ""
  });
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(false);
  // K-03: số phiếu tự sinh cố định cho mỗi lần lập phiếu → gửi trùng (bấm đúp) bị backend từ chối
  const autoRef = React.useRef(newRef());
  const busy = React.useRef(false);

  const setH = (k, v) => setHeader(s => ({ ...s, [k]: v }));
  const setLine = (k, field, v) => setLines(a => a.map(l => l._k === k ? { ...l, [field]: v } : l));

  const onProductChange = async (k, id) => {
    const p = (lookups.products || []).find(x => x.id === id);
    setLines(a => a.map(l => l._k === k ? { ...l, product_id: id, unit: p?.unit || "", spec_key: "", lot_code: "", rows: null } : l));
    if (id) {
      try {
        const tree = await inventory.tree({ product_id: id });
        const rows = (tree || []).filter(r => r.product_id === id);
        setLines(a => a.map(l => l._k === k && l.product_id === id ? { ...l, rows } : l));
      } catch { /* ignore */ }
    }
  };

  // Đổi kho xuất: thông số / lô đã chọn có thể không còn ở vị trí mới → chọn lại
  const onLocationChange = (locId) => {
    setH("location_id", locId);
    setLines(a => a.map(l => ({ ...l, spec_key: "", lot_code: "" })));
  };

  const addLine = () => setLines(a => [...a, emptyLine()]);
  const rmLine = (k) => setLines(a => a.filter(l => l._k !== k));

  const save = async () => {
    if (!header.location_id) return toast.error("Chọn kho / vị trí xuất hàng");
    const validLines = lines.filter(l => l.product_id && Number(l.quantity) > 0)
      .map(l => ({ ...l, ...lineStock(l, header.location_id) }));
    if (!validLines.length) return toast.error("Nhập ít nhất 1 sản phẩm với số lượng > 0");
    const noSpec = validLines.filter(l => !l.spec && l.specs.length > 1);
    if (noSpec.length) {
      const names = noSpec.map(l => (lookups.products || []).find(x => x.id === l.product_id)?.product_code || "").join(", ");
      return toast.error(`Sản phẩm ${names} có nhiều thông số tại vị trí này — vui lòng chọn thông số cần xuất.`);
    }

    // Chặn cứng: không cho phép xuất kho khi số lượng vượt tồn hiện có
    const overStock = validLines.filter(l => l.available !== null && Number(l.quantity) > l.available);
    if (overStock.length > 0) {
      const details = overStock.map(l => {
        const p = (lookups.products || []).find(x => x.id === l.product_id);
        return `• ${p?.product_code || ""} ${p?.product_name || l.product_id}: tồn ${l.available} ${l.unit}, xuất ${l.quantity} ${l.unit}`;
      }).join("\n");
      return toast.error(`Không đủ tồn kho — vui lòng kiểm tra lại:\n${details}`);
    }

    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    const finalRef = header.ref_code.trim() || autoRef.current;
    try {
      if (header.purpose === "Giao cho khách hàng") {
        await inventory.createOutboundSlip({
          purpose: header.purpose,
          location_id: header.location_id,
          note: header.note,
          lines: validLines.map(l => ({
            product_id: l.product_id, quantity: Number(l.quantity), unit: l.unit,
            lot_code: l.lot, spec_key: l.spec || null, note: l.note,
          })),
        });
        toast.success(`Đã tạo Phiếu chờ xuất kho cho khách hàng!`);
      } else {
        // K-03: cả phiếu là MỘT request / MỘT transaction — 1 dòng thiếu tồn thì không dòng nào bị trừ
        await inventory.adjust({
          trx_type: "Xuất",
          location_id: header.location_id,
          ref_code: finalRef,
          lines: validLines.map(l => ({
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit: l.unit,
            lot_code: l.lot,
            spec_key: l.spec || null,
            note: [header.purpose, header.note, l.note].filter(Boolean).join(" | "),
          })),
        });
        toast.success(`Đã xuất kho ${validLines.length} dòng sản phẩm thành công!`);
      }
      setLines([emptyLine()]);
      setHeader(h => ({ ...h, ref_code: "" }));
      autoRef.current = newRef();
      onSaved();
    } catch (e) {
      toast.error("Lỗi: " + e.message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  // Chỉ hiện vị trí mà MỌI sản phẩm đã chọn đều còn hàng
  const selectedProductLines = lines.filter(l => l.product_id && l.rows);
  let validLocationIds = null;
  if (selectedProductLines.length > 0) {
    validLocationIds = selectedProductLines.reduce((acc, l) => {
      const locs = new Set(l.rows.filter(r => Number(r.quantity) > 0 && r.location_id).map(r => r.location_id));
      if (acc === null) return locs;
      return new Set([...acc].filter(x => locs.has(x)));
    }, null);
  }

  const locationsToShow = validLocationIds 
    ? (lookups.locations || []).filter(l => validLocationIds.has(l.id))
    : (lookups.locations || []);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 bg-rose-50 border-b border-rose-100 flex items-center gap-3">
        <Upload size={20} className="text-rose-600" />
        <h3 className="font-semibold text-rose-800">Tạo phiếu xuất kho</h3>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Số phiếu">
            <input className={inputCls} placeholder="Tự động nếu trống" value={header.ref_code}
              onChange={e => setH("ref_code", e.target.value)} />
          </Field>
          {/* K-03: sổ kho ghi theo ngày giờ lúc lưu (backend không nhận ngày chứng từ) → không cho chọn ngày */}
          <Field label="Ngày ghi sổ">
            <div className={`${inputCls} bg-slate-50 text-slate-500`}>Hôm nay ({fmtDate(todayYmd())})</div>
          </Field>
          <Field label="Mục đích xuất" required>
            <select className={inputCls} value={header.purpose} onChange={e => setH("purpose", e.target.value)}>
              {OUTBOUND_PURPOSES.map(s => <option key={s}>{s}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Chuyển kho → màn Chuyển kho</p>
          </Field>
          <Field label="Kho / Vị trí xuất" required>
            <select className={inputCls} value={header.location_id} onChange={e => onLocationChange(e.target.value)}>
              <option value="">-- Chọn kho/vị trí --</option>
              {locationsToShow.map(l => (
                <option key={l.id} value={l.id}>{l.warehouse_name} · {l.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700">Danh sách hàng xuất</span>
            <button onClick={addLine} className="btn-ghost text-sm flex items-center gap-1.5">
              <Plus size={14} /> Thêm dòng
            </button>
          </div>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <th className="px-3 py-2.5 text-left">Sản phẩm *</th>
                  <th className="px-3 py-2.5 w-44">Thông số</th>
                  <th className="px-3 py-2.5 text-right w-28">Tồn hiện tại</th>
                  <th className="px-3 py-2.5 text-right w-28">Số lượng *</th>
                  <th className="px-3 py-2.5 w-24">Đơn vị</th>
                  <th className="px-3 py-2.5 w-32">Số lô</th>
                  <th className="px-3 py-2.5">Ghi chú</th>
                  <th className="px-3 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map(l => {
                  const st = lineStock(l, header.location_id);
                  const overQty = st.available !== null && Number(l.quantity) > st.available;
                  return (
                    <tr key={l._k} className={`hover:bg-slate-50/50 ${overQty ? "bg-rose-50/40" : ""}`}>
                      <td className="px-3 py-2">
                        <SearchSelect
                          value={l.product_id}
                          onChange={v => onProductChange(l._k, v)}
                          options={(lookups.products || []).map(p => ({ value: p.id, label: `${p.product_code} · ${p.product_name}` }))}
                          placeholder="-- Chọn sản phẩm --"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {st.specs.length > 1 ? (
                          <select className={`${inputCls} ${!st.spec ? "border-amber-400" : ""}`} value={l.spec_key}
                            onChange={e => setLines(a => a.map(x => x._k === l._k ? { ...x, spec_key: e.target.value, lot_code: "" } : x))}>
                            <option value="">-- Chọn thông số --</option>
                            {st.specs.map(k => <option key={k} value={k}>{specLabel(k)}</option>)}
                          </select>
                        ) : <span className="text-xs text-slate-500">{st.specs.length === 1 ? specLabel(st.specs[0]) : "—"}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {st.available !== null
                          ? <span className={`font-medium ${st.available <= 0 ? "text-rose-600" : "text-slate-600"}`}>{fmt(st.available)}</span>
                          : <span className="text-slate-300">—</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        <div className="relative">
                          <input type="number" min="0" className={`${inputCls} text-right ${overQty ? "border-rose-400 focus:ring-rose-500/40" : ""}`}
                            value={l.quantity} onChange={e => setLine(l._k, "quantity", e.target.value)} />
                          {overQty && <AlertTriangle size={13} className="absolute right-2 top-2.5 text-rose-500" />}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <UnitSelect value={l.unit} onChange={v => setLine(l._k, "unit", v)} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputCls} placeholder={st.lots.length === 1 ? st.lots[0] : "Số lô"} value={l.lot_code || ""}
                          list={`lot-${l._k}`}
                          onChange={e => setLine(l._k, "lot_code", e.target.value)} />
                        {st.lots.length > 0 && (
                          <datalist id={`lot-${l._k}`}>
                            {st.lots.map(lot => <option key={lot} value={lot} />)}
                          </datalist>
                        )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <Field label="Ghi chú phiếu">
          <input className={inputCls} placeholder="Ghi chú chung cho phiếu xuất…" value={header.note}
            onChange={e => setH("note", e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">
            <Save size={16} /> {saving ? "Đang lưu…" : "Xác nhận xuất kho"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Phiếu chờ xuất kho (do "Yêu cầu NVL" ở lệnh SX tạo ra) — xác nhận mới trừ kho
function PendingSlips({ canConfirm, onConfirmed }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await inventory.outboundSlips({ status: "Chờ xuất" })); }
    catch (e) { toast.error("Lỗi: " + e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail(null);
    try { setDetail(await inventory.outboundSlip(id)); }
    catch (e) { toast.error("Lỗi: " + e.message); }
  };

  const confirm = async (s) => {
    if (!window.confirm(`Xác nhận xuất kho phiếu ${s.slip_code}? Thao tác này sẽ TRỪ TỒN KHO.`)) return;
    setBusy(true);
    try {
      const r = await inventory.confirmOutboundSlip(s.id);
      toast.success(r.message || "Đã xuất kho.");
      setOpenId(null); setDetail(null);
      await load(); onConfirmed && onConfirmed();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const cancel = async (s) => {
    if (!window.confirm(`Hủy phiếu ${s.slip_code}? Lệnh sản xuất nguồn sẽ được mở khóa để yêu cầu lại.`)) return;
    setBusy(true);
    try {
      const r = await inventory.cancelOutboundSlip(s.id);
      toast.success(r.message || "Đã hủy phiếu.");
      setOpenId(null); setDetail(null);
      await load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-amber-200">
      <div className="px-5 py-4 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-amber-800">
          <ClipboardList size={18} /> Phiếu chờ xuất kho
          {rows.length > 0 && <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 text-xs">{rows.length}</span>}
        </div>
        <button onClick={load} className="btn-ghost text-sm flex items-center gap-1.5">
          <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Làm mới
        </button>
      </div>
      <div className="p-4">
        {rows.length === 0 ? (
          <div className="text-center text-slate-400 py-6 text-sm">{loading ? "Đang tải…" : "Không có phiếu nào chờ xuất."}</div>
        ) : (
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {rows.map((s) => (
              <div key={s.id}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/60">
                  <button onClick={() => toggle(s.id)} className="text-slate-400 hover:text-slate-600">
                    {openId === s.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-700">{s.slip_code}
                      <span className="ml-2 text-xs font-normal text-slate-400">{s.prod_order_code ? `Lệnh ${s.prod_order_code}` : (s.purpose || "")}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {s.warehouse_name ? `${s.warehouse_name}${s.location_name ? " · " + s.location_name : ""} · ` : ""}
                      {s.line_count} dòng · tổng {fmt(s.total_qty)} · {fmtDateTime(s.created_at)}
                    </div>
                  </div>
                  {canConfirm && <>
                    <button onClick={() => confirm(s)} disabled={busy}
                      className="btn-ghost text-emerald-700 border-emerald-300 hover:bg-emerald-50 text-sm flex items-center gap-1.5">
                      <Check size={15} /> Xác nhận xuất
                    </button>
                    <button onClick={() => cancel(s)} disabled={busy}
                      className="btn-ghost text-rose-600 border-rose-200 hover:bg-rose-50 text-sm flex items-center gap-1.5">
                      <Ban size={15} /> Hủy
                    </button>
                  </>}
                </div>
                {openId === s.id && (
                  <div className="px-4 pb-4 bg-slate-50/50">
                    {!detail ? <div className="text-xs text-slate-400 py-2">Đang tải chi tiết…</div> : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-slate-500 text-xs uppercase tracking-wide text-left">
                            <th className="px-3 py-2">Vật tư</th>
                            <th className="px-3 py-2 text-right w-28">SL xuất</th>
                            <th className="px-3 py-2 w-20">ĐVT</th>
                            <th className="px-3 py-2 text-right w-28">Tồn hiện tại</th>
                            <th className="px-3 py-2">Ghi chú</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(detail.lines || []).map((l) => {
                            const short = Number(l.quantity) > Number(l.on_hand);
                            return (
                              <tr key={l.id} className={short ? "bg-rose-50/40" : ""}>
                                <td className="px-3 py-2"><span className="text-blue-600 font-medium">{l.product_code}</span> · {l.product_name}</td>
                                <td className="px-3 py-2 text-right font-semibold text-rose-600">−{fmt(l.quantity)}</td>
                                <td className="px-3 py-2 text-slate-500">{l.unit || ""}</td>
                                <td className={`px-3 py-2 text-right ${short ? "text-rose-600 font-semibold" : "text-slate-600"}`}>
                                  {fmt(l.on_hand)}{short && <span className="block text-[11px] font-normal">thiếu {fmt(Number(l.quantity) - Number(l.on_hand))}</span>}
                                </td>
                                <td className="px-3 py-2 text-slate-400 text-xs">{l.note || ""}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OutboundHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useRemembered("outbound:range", defaultRange);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await inventory.transactions({ trx_type: "Xuất", ...range, limit: 2000 })); }
    catch (e) { toast.error("Lỗi: " + e.message); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { key: "created_at", label: "Thời gian", render: r => fmtDateTime(r.created_at) },
    { key: "product_code", label: "Mã SP", filter: "text", tdClass: "font-medium text-blue-600" },
    { key: "product_name", label: "Sản phẩm", filter: "select" },
    { key: "quantity", label: "Số lượng", align: "right", render: r => <span className="font-semibold text-rose-600">−{fmt(r.quantity)}</span> },
    { key: "warehouse_name", label: "Kho/Vị trí", render: r => r.warehouse_name ? `${r.warehouse_name}${r.location_name ? " · " + r.location_name : ""}` : "—" },
    { key: "lot_code", label: "Lô", render: r => r.lot_code || "—" },
    { key: "ref_code", label: "Số phiếu", filter: "text", render: r => r.ref_code || "—" },
    byColumn,
    { key: "note", label: "Ghi chú / Mục đích", tdClass: "text-slate-400 text-xs" },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-slate-700">
          <History size={16} /> Lịch sử phiếu xuất
        </div>
        <div className="flex-1" />
        <div className="mr-3"><TrxRange value={range} onChange={setRange} /></div>
        <button onClick={load} className="btn-ghost text-sm flex items-center gap-1.5">
          <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Làm mới
        </button>
      </div>
      <div className="p-4">
        <DataTable dense loading={loading} columns={columns} rows={rows} rowKey={r => r.id}
          emptyText="Chưa có phiếu xuất" />
      </div>
    </div>
  );
}

export default function OutboundModule({ lookups }) {
  const { can } = usePerm();
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-6">
      <PageHeader title="Xuất kho" icon={Upload} />
      {can("inv_outbound", "view") && (
        <PendingSlips key={"pending" + refreshKey}
          canConfirm={can("inv_outbound", "create") || can("inv_outbound", "edit")}
          onConfirmed={() => setRefreshKey(k => k + 1)} />
      )}
      {(can("inv_outbound", "create") || can("inv_outbound", "edit")) && (
        <OutboundForm lookups={lookups} onSaved={() => setRefreshKey(k => k + 1)} />
      )}
      {can("inv_outbound", "view") && (
        <OutboundHistory key={refreshKey} />
      )}
    </div>
  );
}
