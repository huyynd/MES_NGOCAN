import React, { useState, useEffect, useCallback } from "react";
import { Upload, Save, Plus, Trash2, RefreshCcw, History, AlertTriangle, PackageCheck, Check, Ban, ChevronRight, ChevronDown, ClipboardList } from "lucide-react";
import { DataTable, PageHeader, UnitSelect, SearchSelect } from "../../components.jsx";
import { inventory } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import { inputCls, fmt, fmtDate, toast, todayYmd } from "../../ui.js";

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
  </div>
);

const OUTBOUND_PURPOSES = ["Giao cho khách hàng", "Xuất cho sản xuất", "Xuất trả NCC", "Hủy / Phế liệu", "Chuyển kho", "Khác"];

const emptyLine = () => ({
  _k: Math.random(), product_id: "", quantity: "", unit: "", lot_code: "", available: null, availableLots: [], availableLocations: null, note: ""
});

function OutboundForm({ lookups, onSaved }) {
  const [header, setHeader] = useState({
    ref_code: "", outbound_date: todayYmd(),
    location_id: "", purpose: "Giao cho khách hàng", note: ""
  });
  const [lines, setLines] = useState([emptyLine()]);
  const [saving, setSaving] = useState(false);
  // Ref lưu location_id hiện tại để dùng trong async callbacks
  const locationRef = React.useRef("");

  const setH = (k, v) => setHeader(s => ({ ...s, [k]: v }));
  const setLine = (k, field, v) => setLines(a => a.map(l => l._k === k ? { ...l, [field]: v } : l));

  // Lấy tồn kho của 1 sản phẩm tại vị trí đang chọn
  const fetchAvailable = async (product_id) => {
    if (!product_id) return { total: null, lots: [], locations: [] };
    try {
      const tree = await inventory.tree({ product_id });
      const availableLocations = [...new Set((tree || []).filter(r => r.quantity > 0 && r.location_id).map(r => r.location_id))];
      const locId = locationRef.current;
      // Nếu đã chọn kho: chỉ tính tồn tại kho đó
      // Nếu chưa chọn kho: tính tồn tích lũy toàn bộ
      const rows = locId
        ? (tree || []).filter(x => x.product_id === product_id && x.location_id === locId)
        : (tree || []).filter(x => x.product_id === product_id);
      const total = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
      const lots = [...new Set(rows.filter(r => r.quantity > 0 && r.lot_code).map(r => r.lot_code))];
      return { total, lots, locations: availableLocations };
    } catch { return { total: null, lots: [], locations: [] }; }
  };

  const onProductChange = async (k, id) => {
    const p = (lookups.products || []).find(x => x.id === id);
    setLines(a => a.map(l => l._k === k ? { ...l, product_id: id, unit: p?.unit || "", available: null, availableLots: [], availableLocations: null } : l));
    if (id) {
      const { total, lots, locations } = await fetchAvailable(id);
      setLines(a => a.map(l => l._k === k ? { 
        ...l, 
        available: total, 
        availableLots: lots,
        availableLocations: locations,
        lot_code: lots.length === 1 ? lots[0] : (l.lot_code || "") 
      } : l));
    }
  };

  // Khi đổi kho xuất: cập nhật lại tồn kho của tất cả dòng hàng
  const onLocationChange = async (locId) => {
    locationRef.current = locId;
    setH("location_id", locId);
    // Reset available rồi fetch lại
    setLines(a => a.map(l => ({ ...l, available: null, availableLots: [] })));
    const currentLines = lines.filter(l => l.product_id);
    for (const l of currentLines) {
      const { total, lots, locations } = await fetchAvailable(l.product_id);
      setLines(a => a.map(x => x._k === l._k ? { 
        ...x, 
        available: total,
        availableLots: lots,
        availableLocations: locations,
        lot_code: lots.length === 1 ? lots[0] : (x.lot_code || "")
      } : x));
    }
  };

  const addLine = () => setLines(a => [...a, emptyLine()]);
  const rmLine = (k) => setLines(a => a.filter(l => l._k !== k));

  const save = async () => {
    if (!header.location_id) return toast.error("Chọn kho / vị trí xuất hàng");
    const validLines = lines.filter(l => l.product_id && Number(l.quantity) > 0);
    if (!validLines.length) return toast.error("Nhập ít nhất 1 sản phẩm với số lượng > 0");

    // Chặn cứng: không cho phép xuất kho khi số lượng vượt tồn hiện có
    const overStock = validLines.filter(l => l.available !== null && Number(l.quantity) > l.available);
    if (overStock.length > 0) {
      const details = overStock.map(l => {
        const p = (lookups.products || []).find(x => x.id === l.product_id);
        return `• ${p?.product_code || ""} ${p?.product_name || l.product_id}: tồn ${l.available} ${l.unit}, xuất ${l.quantity} ${l.unit}`;
      }).join("\n");
      return toast.error(`Không đủ tồn kho — vui lòng kiểm tra lại:\n${details}`);
    }

    setSaving(true);
    const finalRef = header.ref_code.trim() || `XK${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}`;
    try {
      if (header.purpose === "Giao cho khách hàng") {
        await inventory.createOutboundSlip({
          purpose: header.purpose,
          location_id: header.location_id,
          note: header.note,
          lines: validLines
        });
        toast.success(`Đã tạo Phiếu chờ xuất kho cho khách hàng!`);
      } else {
        await Promise.all(validLines.map(l =>
          inventory.adjust({
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit: l.unit,
            location_id: header.location_id,
            lot_code: l.lot_code || "",
            trx_type: "Xuất",
            ref_code: finalRef,
            note: [header.purpose, header.note, l.note].filter(Boolean).join(" | "),
          })
        ));
        toast.success(`Đã xuất kho ${validLines.length} dòng sản phẩm thành công!`);
      }
      setLines([emptyLine()]);
      setHeader(h => ({ ...h, ref_code: "" }));
      onSaved();
    } catch (e) {
      toast.error("Lỗi: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedProductLines = lines.filter(l => l.product_id && l.availableLocations);
  let validLocationIds = null;
  if (selectedProductLines.length > 0) {
    validLocationIds = selectedProductLines.reduce((acc, l) => {
      if (acc === null) return new Set(l.availableLocations);
      return new Set([...acc].filter(x => l.availableLocations.includes(x)));
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
          <Field label="Ngày xuất" required>
            <input type="date" className={inputCls} value={header.outbound_date}
              onChange={e => setH("outbound_date", e.target.value)} />
          </Field>
          <Field label="Mục đích xuất" required>
            <select className={inputCls} value={header.purpose} onChange={e => setH("purpose", e.target.value)}>
              {OUTBOUND_PURPOSES.map(s => <option key={s}>{s}</option>)}
            </select>
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
                  const overQty = l.available !== null && Number(l.quantity) > l.available;
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
                      <td className="px-3 py-2 text-right">
                        {l.available !== null
                          ? <span className={`font-medium ${l.available <= 0 ? "text-rose-600" : "text-slate-600"}`}>{fmt(l.available)}</span>
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
                        <input className={inputCls} placeholder="Số lô" value={l.lot_code || ""}
                          list={`lot-${l._k}`}
                          onChange={e => setLine(l._k, "lot_code", e.target.value)} />
                        {l.availableLots && l.availableLots.length > 0 && (
                          <datalist id={`lot-${l._k}`}>
                            {l.availableLots.map(lot => <option key={lot} value={lot} />)}
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
                      {s.line_count} dòng · tổng {fmt(s.total_qty)} · {new Date(s.created_at).toLocaleString("vi-VN")}
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
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await inventory.transactions({ trx_type: "Xuất" })); }
    catch (e) { toast.error("Lỗi: " + e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { key: "created_at", label: "Thời gian", render: r => new Date(r.created_at).toLocaleString("vi-VN") },
    { key: "product_code", label: "Mã SP", filter: "text", tdClass: "font-medium text-blue-600" },
    { key: "product_name", label: "Sản phẩm", filter: "select" },
    { key: "quantity", label: "Số lượng", align: "right", render: r => <span className="font-semibold text-rose-600">−{fmt(r.quantity)}</span> },
    { key: "warehouse_name", label: "Kho/Vị trí", render: r => r.warehouse_name ? `${r.warehouse_name}${r.location_name ? " · " + r.location_name : ""}` : "—" },
    { key: "lot_code", label: "Lô", render: r => r.lot_code || "—" },
    { key: "ref_code", label: "Số phiếu", filter: "text", render: r => r.ref_code || "—" },
    { key: "note", label: "Ghi chú / Mục đích", tdClass: "text-slate-400 text-xs" },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-slate-700">
          <History size={16} /> Lịch sử phiếu xuất
        </div>
        <button onClick={load} className="btn-ghost text-sm flex items-center gap-1.5">
          <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Làm mới
        </button>
      </div>
      <div className="p-4">
        <DataTable dense columns={columns} rows={rows} rowKey={r => r.id}
          emptyText={loading ? "Đang tải…" : "Chưa có phiếu xuất"} />
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
