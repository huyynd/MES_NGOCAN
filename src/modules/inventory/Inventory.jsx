import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, PackagePlus, Save, Warehouse, History, ExternalLink, Plus, Trash2, ChevronRight, Layers, Boxes } from "lucide-react";
import { ListHeader, DataTable, PageHeader, Section, UnitSelect, SearchSelect } from "../../components.jsx";
import { inventory } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import {  inputCls, fmt, fmtDate, statusClass , toast } from "../../ui.js";
import { PRODUCT_SPECS, splitNU, specShort } from "../../specs.js";

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
  </div>
);

/* Bộ ô nhập thông số kỹ thuật (dùng ở Nhập/Xuất & thêm dòng tồn) */
function SpecFields({ specs, onChange, disabled, cls = inputCls }) {
  const get = (n) => specs?.[n] || "";
  const setV = (n, v) => { const next = { ...specs }; if (v) next[n] = v; else delete next[n]; onChange(next); };
  return (
    <>
      {PRODUCT_SPECS.map((spec) => {
        const lbl = <span className="block text-xs font-medium text-slate-500 mb-1">{spec.name}</span>;
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
        if (spec.kind === "text") {
          return (
            <label key={spec.name}>{lbl}
              <input type="text" className={cls} disabled={disabled} value={get(spec.name)} placeholder={spec.placeholder || ""}
                onChange={(e) => setV(spec.name, e.target.value)} />
            </label>
          );
        }
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
    </>
  );
}

function AdjustModal({ lookups, onClose, onSaved }) {
  const [f, setF] = useState({ product_id: "", trx_type: "Nhập", quantity: "", unit: "", location_id: "", lot_code: "", note: "" });
  const [specs, setSpecs] = useState({});
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const onProduct = (id) => {
    const p = lookups.products.find((x) => x.id === id);
    setF((s) => ({ ...s, product_id: id, unit: p?.unit || s.unit }));
  };
  const save = async () => {
    if (!f.product_id) return toast.error("Chọn sản phẩm");
    if (!f.quantity || Number(f.quantity) <= 0) return toast.error("Nhập số lượng hợp lệ");
    if (!f.location_id) return toast.error("Chọn kho / vị trí");
    try { await inventory.adjust({ ...f, specs }); toast.success("Đã ghi nhận giao dịch thành công"); onSaved(); }
    catch (e) { toast.error("Lỗi: " + e.message); }
  };
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-800">Nhập / Xuất / Điều chỉnh tồn</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Sản phẩm" required>
            <SearchSelect
              value={f.product_id}
              onChange={onProduct}
              options={lookups.products.map((p) => ({ value: p.id, label: `${p.product_code} · ${p.product_name}` }))}
              placeholder="-- Chọn --"
            />
          </Field>
          <Field label="Loại giao dịch" required>
            <select className={inputCls} value={f.trx_type} onChange={(e) => set("trx_type", e.target.value)}>
              <option>Nhập</option><option>Xuất</option><option>Điều chỉnh</option>
            </select>
          </Field>
          <Field label="Số lượng" required>
            <input type="number" min="0" className={inputCls} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} />
          </Field>
          <Field label="Đơn vị">
            <UnitSelect value={f.unit} onChange={(v) => set("unit", v)} />
          </Field>
          <Field label="Vị trí lưu trữ">
            <select className={inputCls} value={f.location_id} onChange={(e) => set("location_id", e.target.value)}>
              <option value="">-- Không xác định --</option>
              {lookups.locations.map((l) => <option key={l.id} value={l.id}>{l.warehouse_name} · {l.name}</option>)}
            </select>
          </Field>
          <Field label="Lô sản xuất">
            <input className={inputCls} value={f.lot_code} placeholder="VD: LSX00007 / Thủ công" onChange={(e) => set("lot_code", e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Thông số kỹ thuật</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <SpecFields specs={specs} onChange={setSpecs} />
          </div>
        </div>
        <Field label="Ghi chú"><input className={inputCls} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">Hủy</button>
          <button onClick={save} className="btn-primary"><Save size={16} /> Lưu</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Tab Tồn kho: cây 3 cấp Sản phẩm → Nhóm thông số → Lô sản xuất ---- */

/* ---- Tab Tồn kho: 2 chế độ xem (Theo sản phẩm / Theo vị trí) ---- */
function TreeTab({ lookups }) {
  const { can } = usePerm();
  const [data, setData] = useState([]);
  const [q, setQ] = useState("");
  const [filterWh, setFilterWh] = useState("");
  const [filterZone, setFilterZone] = useState("");
  const [filterType, setFilterType] = useState("");
  const [viewMode, setViewMode] = useState("location"); // "product" | "location"
  const [openState, setOpenState] = useState(() => new Set());
  const [adjusting, setAdjusting] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showZero, setShowZero] = useState(false); // mặc định ẩn các lô 0 kg

  const load = useCallback(async () => {
    try { 
      const res = await inventory.tree({});
      setData(res.data || res);
    } catch (e) { toast.error("Lỗi tải tồn kho: " + e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = (key) => { 
    setOpenState(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  const norm = (s) => (s || "").toString().toLowerCase();
  
  // Bước 1: Lọc dữ liệu phẳng
  let filteredData = data.filter(r => {
    if (!showZero && Math.abs(Number(r.quantity) || 0) < 1e-9) return false; // ẩn lô 0 kg (lô đã trừ hết)
    if (q && !norm(r.product_code).includes(norm(q)) && !norm(r.product_name).includes(norm(q)) && !norm(r.lot_code).includes(norm(q))) return false;
    if (filterWh && r.warehouse_id !== filterWh) return false;
    if (filterZone && r.zone_id !== filterZone) return false;
    if (filterType && r.product_type !== filterType) return false;
    return true;
  });

  // Bước 2: Gom nhóm theo Product
  const buildTreeByProduct = (rows) => {
    const prods = new Map();
    for (const r of rows) {
      if (!prods.has(r.product_id)) {
        prods.set(r.product_id, {
          product_id: r.product_id, product_code: r.product_code, product_name: r.product_name,
          product_type: r.product_type, min_quantity: r.min_quantity, warehouse_limits: r.warehouse_limits || [], unit: r.unit, total: 0, groups: new Map(), warehouse_totals: {},
        });
      }
      const P = prods.get(r.product_id);
      P.total += Number(r.quantity) || 0;
      if (r.warehouse_id) {
        P.warehouse_totals[r.warehouse_id] = (P.warehouse_totals[r.warehouse_id] || 0) + (Number(r.quantity) || 0);
      }
      if (!P.unit && r.unit) P.unit = r.unit;
      const gkey = r.spec_key || '';
      if (!P.groups.has(gkey)) P.groups.set(gkey, { spec_key: gkey, specs: r.specs || {}, total: 0, lots: [] });
      const G = P.groups.get(gkey);
      G.total += Number(r.quantity) || 0;
      G.lots.push({
        id: r.id, lot_code: r.lot_order_code || r.lot_code || '', quantity: Number(r.quantity) || 0,
        unit: r.unit, warehouse_name: r.warehouse_name, zone_name: r.zone_name, location_name: r.location_name,
        expiry_date: r.expiry_date, prod_order_id: r.prod_order_id,
      });
    }
    let arr = [...prods.values()].map((P) => ({ ...P, groups: [...P.groups.values()] }));
    if (lowStockOnly) {
      arr = arr.filter(p => p.warehouse_limits && p.warehouse_limits.some(w => {
        const qty = p.warehouse_totals?.[w.warehouse_id] || 0;
        return w.min_quantity != null && qty < Number(w.min_quantity);
      }));
    }
    return arr;
  };

  // Bước 3: Gom nhóm theo Location
  const buildTreeByLocation = (rows) => {
    const whs = new Map();
    // 1. Dựng sẵn cây từ danh mục để hiển thị cả những Khu/Vị trí trống (0 tồn)
    (lookups.warehouses || []).forEach(w => {
      whs.set(w.id, { id: w.id, name: w.name, total: 0, zones: new Map() });
    });
    (lookups.zones || []).forEach(z => {
      if (whs.has(z.warehouse_id)) {
        whs.get(z.warehouse_id).zones.set(z.id, { id: z.id, name: z.name, total: 0, locs: new Map() });
      }
    });
    (lookups.locations || []).forEach(l => {
      if (whs.has(l.warehouse_id)) {
        const W = whs.get(l.warehouse_id);
        if (l.zone_id && W.zones.has(l.zone_id)) {
          W.zones.get(l.zone_id).locs.set(l.id, { id: l.id, name: l.name, total: 0, prods: new Map() });
        }
      }
    });

    // 2. Lấp dữ liệu tồn kho vào cây
    for (const r of rows) {
      const whId = r.warehouse_id || "unknown";
      if (!whs.has(whId)) whs.set(whId, { id: whId, name: r.warehouse_name || "(Chưa phân kho)", total: 0, zones: new Map() });
      const W = whs.get(whId);
      W.total += Number(r.quantity) || 0;

      const znId = r.zone_id || "unknown";
      if (!W.zones.has(znId)) W.zones.set(znId, { id: znId, name: r.zone_name || "(Không phân khu)", total: 0, locs: new Map() });
      const Z = W.zones.get(znId);
      Z.total += Number(r.quantity) || 0;

      const locId = r.location_id || "unknown";
      if (!Z.locs.has(locId)) Z.locs.set(locId, { id: locId, name: r.location_name || "(Không có vị trí)", total: 0, prods: new Map() });
      const L = Z.locs.get(locId);
      L.total += Number(r.quantity) || 0;

      const pkey = r.product_id + '|' + (r.spec_key || '');
      if (!L.prods.has(pkey)) L.prods.set(pkey, { 
         product_id: r.product_id, product_code: r.product_code, product_name: r.product_name, specs: r.specs, unit: r.unit, total: 0, lots: []
      });
      const P = L.prods.get(pkey);
      P.total += Number(r.quantity) || 0;
      P.lots.push({
        id: r.id, lot_code: r.lot_order_code || r.lot_code || '', quantity: Number(r.quantity) || 0,
        unit: r.unit, expiry_date: r.expiry_date
      });
    }

    let arr = [...whs.values()].map(W => ({
      ...W, zones: [...W.zones.values()].map(Z => ({
        ...Z, locs: [...Z.locs.values()].map(L => ({
          ...L, prods: [...L.prods.values()]
        }))
      }))
    }));

    // 3. Lọc theo giao diện (nếu user đang dùng filter hoặc search)
    if (filterWh) arr = arr.filter(w => w.id === filterWh);
    if (filterZone) {
      arr.forEach(w => { w.zones = w.zones.filter(z => z.id === filterZone) });
    }
    
    // Nếu đang tìm kiếm text (q) thì ẩn bớt các vị trí trống không khớp để đỡ rối
    if (q) {
      arr.forEach(w => {
        w.zones.forEach(z => {
          z.locs = z.locs.filter(l => l.prods.length > 0);
        });
        w.zones = w.zones.filter(z => z.locs.length > 0 || z.total > 0);
      });
      arr = arr.filter(w => w.zones.length > 0 || w.total > 0);
    }

    return arr;
  };

  const zonesList = filterWh ? (lookups.zones || []).filter(z => z.warehouse_id === filterWh) : (lookups.zones || []);

  const renderProductView = () => {
    const tree = buildTreeByProduct(filteredData);
    if (tree.length === 0) return <div className="px-4 py-10 text-center text-slate-400 text-sm">Chưa có tồn kho phù hợp</div>;
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2.5 bg-slate-50 text-slate-500 text-xs uppercase tracking-wide font-semibold border-b border-slate-100">
          <div className="col-span-7">Sản phẩm / Nhóm thông số / Lô</div>
          <div className="col-span-3">Kho · Khu · Vị trí</div>
          <div className="col-span-2 text-right">Tồn</div>
        </div>
        {tree.map(p => {
          const pOpen = openState.has("P" + p.product_id);
          return (
            <div key={p.product_id} className="border-b border-slate-100 last:border-0">
              <button onClick={() => toggle("P" + p.product_id)}
                className="w-full grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50/70 text-left">
                <div className="col-span-7 flex items-center gap-2 min-w-0">
                  <ChevronRight size={16} className={`text-slate-400 transition-transform shrink-0 ${pOpen ? "rotate-90" : ""}`} />
                  <Boxes size={16} className="text-blue-500 shrink-0" />
                  <span className="font-semibold text-blue-600 shrink-0">{p.product_code}</span>
                  <span className="text-slate-700 truncate">{p.product_name}</span>
                  <span className={`ml-1 inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${statusClass(p.product_type)}`}>{p.product_type}</span>
                  {p.warehouse_limits && p.warehouse_limits.filter(w => {
                    const qty = p.warehouse_totals?.[w.warehouse_id] || 0;
                    return w.min_quantity != null && qty < Number(w.min_quantity);
                  }).map(w => {
                    const whName = lookups?.warehouses?.find(x => x.id === w.warehouse_id)?.name || "Kho";
                    return (
                      <span key={w.warehouse_id} className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700" title={`Thiếu hàng tại ${whName} (Tối thiểu: ${fmt(w.min_quantity)}, Thực tế: ${fmt(p.warehouse_totals?.[w.warehouse_id] || 0)})`}>⚠ ${whName}</span>
                    );
                  })}
                  <span className="text-xs text-slate-400">· {p.groups.length} nhóm</span>
                </div>
                <div className="col-span-3 text-slate-400 text-sm">—</div>
                <div className="col-span-2 text-right font-bold text-slate-800">{fmt(p.total)} <span className="text-xs font-normal text-slate-500">{p.unit}</span></div>
              </button>

              {pOpen && p.groups.map(g => {
                const gkey = "G" + p.product_id + "|" + g.spec_key;
                const gOpen = openState.has(gkey);
                const label = specShort(g.specs) || "(không có thông số)";
                return (
                  <div key={gkey} className="bg-slate-50/40">
                    <button onClick={() => toggle(gkey)}
                      className="w-full grid grid-cols-12 px-4 py-2.5 items-center hover:bg-slate-100/60 text-left border-t border-slate-100">
                      <div className="col-span-7 flex items-center gap-2 pl-6 min-w-0">
                        <ChevronRight size={14} className={`text-slate-400 transition-transform shrink-0 ${gOpen ? "rotate-90" : ""}`} />
                        <Layers size={14} className="text-violet-500 shrink-0" />
                        <span className="text-slate-700 text-sm truncate">{label}</span>
                        <span className="text-xs text-slate-400 shrink-0">· {g.lots.length} lô</span>
                      </div>
                      <div className="col-span-3 text-slate-400 text-sm">—</div>
                      <div className="col-span-2 text-right font-semibold text-slate-700">{fmt(g.total)} <span className="text-xs font-normal text-slate-400">{p.unit}</span></div>
                    </button>
                    {gOpen && g.lots.map(lot => (
                      <div key={lot.id} className="grid grid-cols-12 px-4 py-2 items-center border-t border-slate-100 text-sm">
                        <div className="col-span-7 flex items-center gap-2 pl-14 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                          <span className="font-medium text-slate-600 shrink-0">{lot.lot_code || "(không lô)"}</span>
                          {lot.expiry_date && <span className="text-xs text-slate-400">· HSD {fmtDate(lot.expiry_date)}</span>}
                        </div>
                        <div className="col-span-3 text-slate-500">
                          {lot.warehouse_name ? `${lot.warehouse_name}${lot.zone_name ? " · " + lot.zone_name : ""}${lot.location_name ? " · " + lot.location_name : ""}` : "(chưa xác định)"}
                        </div>
                        <div className={`col-span-2 text-right font-medium ${Number(lot.quantity) < 0 ? "text-rose-600" : "text-slate-700"}`}>{fmt(lot.quantity)} <span className="text-xs font-normal text-slate-400">{lot.unit || p.unit}</span></div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const renderLocationView = () => {
    const tree = buildTreeByLocation(filteredData);
    if (tree.length === 0) return <div className="px-4 py-10 text-center text-slate-400 text-sm">Chưa có tồn kho phù hợp</div>;
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2.5 bg-slate-50 text-slate-500 text-xs uppercase tracking-wide font-semibold border-b border-slate-100">
          <div className="col-span-7">Kho / Khu / Vị trí / Sản phẩm</div>
          <div className="col-span-3">Lô</div>
          <div className="col-span-2 text-right">Tồn</div>
        </div>
        {tree.map(w => {
          const wOpen = openState.has("W" + w.id);
          return (
            <div key={w.id} className="border-b border-slate-100 last:border-0">
              <button onClick={() => toggle("W" + w.id)}
                className="w-full grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50/70 text-left">
                <div className="col-span-7 flex items-center gap-2 min-w-0">
                  <ChevronRight size={16} className={`text-slate-400 transition-transform shrink-0 ${wOpen ? "rotate-90" : ""}`} />
                  <Warehouse size={16} className="text-indigo-500 shrink-0" />
                  <span className="font-semibold text-indigo-700 shrink-0">{w.name}</span>
                </div>
                <div className="col-span-3 text-slate-400 text-sm">—</div>
                <div className="col-span-2 text-right font-bold text-slate-800">{fmt(w.total)}</div>
              </button>
              {wOpen && w.zones.map(z => {
                const zOpen = openState.has("Z" + w.id + z.id);
                return (
                  <div key={z.id} className="bg-slate-50/40">
                    <button onClick={() => toggle("Z" + w.id + z.id)}
                      className="w-full grid grid-cols-12 px-4 py-2.5 items-center hover:bg-slate-100/60 text-left border-t border-slate-100">
                      <div className="col-span-7 flex items-center gap-2 pl-6 min-w-0">
                        <ChevronRight size={14} className={`text-slate-400 transition-transform shrink-0 ${zOpen ? "rotate-90" : ""}`} />
                        <span className="font-semibold text-slate-700 text-sm truncate">{z.name}</span>
                      </div>
                      <div className="col-span-3 text-slate-400 text-sm">—</div>
                      <div className="col-span-2 text-right font-semibold text-slate-700">{fmt(z.total)}</div>
                    </button>
                    {zOpen && z.locs.map(l => {
                      const lOpen = openState.has("L" + w.id + z.id + l.id);
                      return (
                        <div key={l.id} className="bg-slate-100/40">
                          <button onClick={() => toggle("L" + w.id + z.id + l.id)}
                            className="w-full grid grid-cols-12 px-4 py-2 items-center hover:bg-slate-200/50 text-left border-t border-slate-100">
                            <div className="col-span-7 flex items-center gap-2 pl-10 min-w-0">
                              <ChevronRight size={14} className={`text-slate-400 transition-transform shrink-0 ${lOpen ? "rotate-90" : ""}`} />
                              <span className="text-slate-600 font-medium text-sm truncate">{l.name}</span>
                            </div>
                            <div className="col-span-3 text-slate-400 text-sm">—</div>
                            <div className="col-span-2 text-right font-medium text-slate-700">{fmt(l.total)}</div>
                          </button>
                          {lOpen && l.prods.map(p => {
                            const pkey = p.product_id + '|' + (p.specs ? JSON.stringify(p.specs) : '');
                            const label = p.product_name + (specShort(p.specs) ? ' (' + specShort(p.specs) + ')' : '');
                            return (
                              <div key={pkey} className="grid grid-cols-12 px-4 py-2 items-center border-t border-slate-100 text-sm bg-white">
                                <div className="col-span-7 flex items-center gap-2 pl-14 min-w-0">
                                  <Boxes size={14} className="text-blue-500 shrink-0" />
                                  <span className="font-medium text-slate-700 shrink-0">{p.product_code}</span>
                                  <span className="text-slate-600 truncate">{label}</span>
                                </div>
                                <div className="col-span-3 text-slate-500">
                                  {p.lots.length > 1 ? `${p.lots.length} lô` : (p.lots[0]?.lot_code || "(không lô)")}
                                </div>
                                <div className="col-span-2 text-right font-medium text-slate-700">{fmt(p.total)} <span className="text-xs font-normal text-slate-400">{p.unit}</span></div>
                              </div>
                            );
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-4 flex-1">
          <input className={`${inputCls} max-w-[200px]`} placeholder="Tìm SP / Lô…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">Kho</span>
            <select className={`${inputCls} w-[150px]`} value={filterWh} onChange={e => { setFilterWh(e.target.value); setFilterZone(""); }}>
              <option value="">Tất cả</option>
              {(lookups.warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">Khu</span>
            <select className={`${inputCls} w-[150px]`} value={filterZone} onChange={e => setFilterZone(e.target.value)}>
              <option value="">Tất cả</option>
              {zonesList.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">Loại</span>
            <select className={`${inputCls} w-[150px]`} value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">Tất cả</option>
              <option>Nguyên vật liệu</option>
              <option>Bán thành phẩm</option>
              <option>Thành phẩm</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer ml-auto">
            <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} className="w-4 h-4 accent-slate-500" />
            Hiện lô 0 kg
          </label>
          {viewMode === "product" && (
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} className="w-4 h-4 accent-rose-600" />
              Chỉ hiện hàng dưới định mức
            </label>
          )}
        </div>
      </div>

      <div className="flex gap-4 items-center">
        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
          <input type="radio" name="viewMode" value="product" checked={viewMode === "product"} onChange={() => setViewMode("product")} className="accent-blue-600 w-4 h-4" />
          Xem theo sản phẩm
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
          <input type="radio" name="viewMode" value="location" checked={viewMode === "location"} onChange={() => setViewMode("location")} className="accent-blue-600 w-4 h-4" />
          Xem theo vị trí lưu trữ
        </label>
      </div>

      {viewMode === "product" ? renderProductView() : renderLocationView()}

      {adjusting && <AdjustModal lookups={lookups} onClose={() => setAdjusting(false)} onSaved={() => { setAdjusting(false); load(); }} />}
    </div>
  );
}


/* ---- Tab: Lịch sử giao dịch kho ---- */
const TRX_COLOR = { "Nhập": "bg-emerald-50 text-emerald-700", "Xuất": "bg-rose-50 text-rose-700", "Điều chỉnh": "bg-amber-50 text-amber-700" };
function TransactionsTab() {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    try { setRows(await inventory.transactions({})); } catch (e) { toast.error("Lỗi tải lịch sử: " + e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { key: "created_at", label: "Thời gian", filter: "date", tdClass: "text-slate-500", render: (t) => new Date(t.created_at).toLocaleString("vi-VN") },
    { key: "trx_type", label: "Loại", filter: "select", render: (t) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${TRX_COLOR[t.trx_type] || ""}`}>{t.trx_type}</span> },
    { key: "product_code", label: "Mã SP", filter: "text", tdClass: "font-medium text-blue-600" },
    { key: "product_name", label: "Sản phẩm", filter: "select", tdClass: "text-slate-800" },
    { key: "_specs", label: "Thông số", filter: "text", tdClass: "text-slate-500",
      filterValue: (t) => specShort(t.specs),
      render: (t) => specShort(t.specs) || "—" },
    { key: "lot_code", label: "Lô", filter: "text", tdClass: "text-slate-600", render: (t) => t.lot_code || "—" },
    { key: "quantity", label: "Số lượng", align: "right", render: (t) => <span className={`font-semibold ${t.trx_type === "Xuất" ? "text-rose-600" : "text-emerald-600"}`}>{t.trx_type === "Xuất" ? "−" : "+"}{fmt(t.quantity)}</span> },
    { key: "warehouse_name", label: "Kho/Vị trí", filter: "select", tdClass: "text-slate-600", render: (t) => t.warehouse_name ? `${t.warehouse_name} · ${t.location_name}` : "—" },
    { key: "ref_code", label: "Chứng từ", filter: "text", tdClass: "text-slate-600", render: (t) => t.ref_code || "—" },
    { key: "note", label: "Ghi chú", filter: "text", tdClass: "text-slate-400", render: (t) => t.note || "" },
  ];

  return <DataTable dense columns={columns} rows={rows} rowKey={(t) => t.id} emptyText="Chưa có giao dịch" />;
}

/* ---- Hub Kho ---- */
export default function InventoryModule({ lookups }) {
  const [tab, setTab] = useState("stock");
  const tabs = [
    { key: "stock", label: "Tồn kho", icon: Warehouse },
    { key: "trx", label: "Lịch sử giao dịch", icon: History },
  ];

  return (
    <div className="space-y-5">
      <ListHeader title="Kho" />
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition flex items-center gap-2 ${
              tab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>
      {tab === "stock" ? <TreeTab lookups={lookups} /> : <TransactionsTab />}
    </div>
  );
}
