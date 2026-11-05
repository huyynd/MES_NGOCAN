import React, { useState, useEffect, useCallback, useMemo } from "react";
import { RotateCcw, ChevronRight } from "lucide-react";
import { ListHeader, DataTable, LoadError, usePager, useRemembered } from "../../components.jsx";
import { inventory } from "../../mesApi.js";
import { inputCls, fmt, fmtDate, statusClass, toast, fmtDateTime } from "../../ui.js";
import { specShort } from "../../specs.js";
import { TRX_COLOR, trxIsIn, defaultRange, TrxRange, byColumn } from "./trxHistory.jsx";

/* ---- Tab Tồn kho: 2 chế độ xem (Theo sản phẩm / Theo vị trí) ----
   Mỗi chế độ chỉ có 1 cấp mở được (sản phẩm hoặc kho); mở ra là bảng con phẳng. */
// K-05: tổng Kho / Khu / Vị trí tách theo đơn vị (không cộng lẫn kg + cuộn + cái)
// ("Kg" và "KG" là cùng 1 đơn vị → gộp không phân biệt hoa/thường, hiện theo cách viết gặp đầu tiên)
const addUnit = (o, r) => {
  const u = (r.unit || "").trim() || "—", k = u.toLowerCase();
  const e = o.byUnit[k] || (o.byUnit[k] = { u, q: 0 });
  e.q += Number(r.quantity) || 0;
};
const unitTotals = (o) => Object.values(o.byUnit || {}).sort((a, b) => b.q - a.q);
const fmtByUnit = (o) => unitTotals(o).map((e) => `${fmt(e.q)} ${e.u}`).join(" · ") || "0";

// Tổng theo đơn vị: số đậm theo `numCls`, đơn vị chữ xám nhỏ
function QtyByUnit({ o, numCls = "font-semibold text-slate-800" }) {
  const items = unitTotals(o);
  if (!items.length) return <span className={numCls}>0</span>;
  return items.map((e, i) => (
    <React.Fragment key={e.u}>
      {i > 0 && <span className="text-slate-400"> · </span>}
      <span className={numCls}>{fmt(e.q)}</span> <span className="text-xs font-normal text-slate-400">{e.u}</span>
    </React.Fragment>
  ));
}

// Ô Tồn của 1 dòng trong bảng con (âm thì đỏ)
function QtyCell({ quantity, unit, className = "" }) {
  return (
    <div className={`text-right tabular-nums whitespace-nowrap ${Number(quantity) < 0 ? "text-rose-600" : "text-slate-700"} ${className}`}>
      {fmt(quantity)} <span className="text-xs text-slate-400">{unit}</span>
    </div>
  );
}

// Ô Khả dụng: có phần đang giữ thì tô xanh và ghi rõ giữ cho gì
function AvailCell({ pending, blocked, available, className = "" }) {
  const held = pending > 0 || blocked > 0;
  return (
    <div className={`text-right tabular-nums ${held ? "font-medium text-emerald-700" : "text-slate-700"} ${className}`}>
      {fmt(available)}
      {held && (
        <span className="block text-xs font-normal text-slate-500">
          {pending > 0 && <>phiếu chờ {fmt(pending)}</>}
          {pending > 0 && blocked > 0 && " · "}
          {blocked > 0 && <>không xuất được {fmt(blocked)}</>}
        </span>
      )}
    </div>
  );
}

function Chevron({ open }) {
  return <ChevronRight size={16} aria-hidden="true" className={`text-slate-400 transition-transform shrink-0 ${open ? "rotate-90" : ""}`} />;
}

const TREE_ROW = "grid grid-cols-[minmax(0,1fr)_104px] md:grid-cols-[minmax(0,1fr)_170px_220px] gap-3 px-3 md:px-4 items-center";
const TREE_HEAD = `${TREE_ROW} py-2.5 bg-slate-50 text-slate-500 text-xs uppercase tracking-wide font-semibold border-b border-slate-100`;
const TREE_TOGGLE = `${TREE_ROW} w-full py-3 hover:bg-slate-50/70 text-left transition-colors`;
const SUB_WRAP = "border-t border-slate-100 bg-slate-50/70 px-3 md:pl-10 md:pr-4 pt-1 pb-3";
const SUB_HEAD = "py-2 text-xs font-semibold text-slate-500 border-b border-slate-200";
const SUB_ROW = "py-2 md:py-1.5 text-sm border-t border-slate-100 first:border-t-0 items-start";
// Điện thoại: bảng con thành từng cụm 2 cột (chữ bên trái, Tồn + Khả dụng bên phải)
const CELL_TEXT = "col-start-1 md:col-start-auto min-w-0";
const CELL_QTY = "col-start-2 row-start-1 md:col-start-auto md:row-start-auto";
const CELL_AVAIL = "col-start-2 row-start-2 row-span-3 md:col-start-auto md:row-start-auto md:row-span-1";
const PRODUCT_GRID = "grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.3fr)_130px_minmax(0,1fr)_110px_130px] gap-x-3";
const LOCATION_GRID = "grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1.5fr)_130px_100px_110px] gap-x-3";

/* Bảng con của 1 sản phẩm. Phân trang theo nhóm thông số để không cắt đôi một nhóm.
   Dòng tổng chỉ hiện khi nó có thêm thông tin: nhóm nhiều lô, và sản phẩm có từ 2 nhóm trở lên. */
function ProductLots({ p }) {
  const { slice, pager } = usePager(p.groups, 10);
  return (
    <div className={SUB_WRAP}>
      <div className={`hidden md:grid ${PRODUCT_GRID} ${SUB_HEAD}`}>
        <div>Thông số</div><div>Lô</div><div>Kho · Khu · Vị trí</div>
        <div className="text-right">Tồn</div><div className="text-right">Khả dụng</div>
      </div>
      {slice.map((g) => {
        const label = specShort(g.specs) || "—";
        const showTotal = g.lots.length > 1 && p.groups.length > 1;
        return (
          <React.Fragment key={g.spec_key}>
            {showTotal && (
              <div className={`${PRODUCT_GRID} ${SUB_ROW} bg-slate-100/60`}>
                <div className={`${CELL_TEXT} font-medium text-slate-700`}>{label}</div>
                <div className={`${CELL_TEXT} text-slate-500`}>{g.lots.length} lô</div>
                <div className="hidden md:block text-xs text-slate-500 md:text-right md:self-center">Tổng</div>
                <div className={`${CELL_QTY} text-right tabular-nums whitespace-nowrap`}><QtyByUnit o={g} /></div>
                <div className="hidden md:block" />
              </div>
            )}
            {g.lots.map((lot) => (
              <div key={lot.id} className={`${PRODUCT_GRID} ${SUB_ROW}`}>
                <div className={`${CELL_TEXT} text-slate-700`}>{showTotal ? <span className="hidden md:inline">&nbsp;</span> : label}</div>
                <div className={`${CELL_TEXT} text-slate-700 truncate`} title={lot.lot_code || undefined}>
                  {lot.lot_code || "(không lô)"}
                  {lot.expiry_date && <span className="block text-xs text-slate-400">HSD {fmtDate(lot.expiry_date)}</span>}
                </div>
                <div className={`${CELL_TEXT} text-slate-500`}>{lot.place}</div>
                <QtyCell quantity={lot.quantity} unit={lot.unit || p.unit} className={CELL_QTY} />
                <AvailCell pending={lot.pending} blocked={lot.blocked} available={lot.available} className={CELL_AVAIL} />
              </div>
            ))}
          </React.Fragment>
        );
      })}
      {p.groups.length > 10 && <div className="pt-2">{pager}</div>}
    </div>
  );
}

/* Bảng con của 1 kho: mỗi dòng = sản phẩm + thông số tại 1 vị trí.
   Hàng nút phía trên giữ số tổng từng vị trí, bấm vào để lọc bảng. Kho chỉ có 1 khu thì ẩn tên khu cho đỡ lặp. */
function WarehouseRows({ w }) {
  const [picked, setPicked] = useState("");
  const oneZone = w.zones.length < 2;
  const locations = useMemo(() => w.zones.flatMap((z) => z.locs.map((l) => ({
    key: `${z.id}|${l.id}`, label: oneZone ? l.name : `${z.name} · ${l.name}`, loc: l,
  }))), [w.zones, oneZone]);
  const current = locations.some((x) => x.key === picked) ? picked : "";
  const rows = useMemo(() => locations.filter((x) => !current || x.key === current).flatMap((x) => x.loc.prods.map((p) => ({
    ...p,
    key: `${x.key}|${p.product_id}|${p.spec_key}`,
    place: x.label,
    pending: p.lots.reduce((s, r) => s + r.pending, 0),
    blocked: p.lots.reduce((s, r) => s + r.blocked, 0),
    available: p.lots.reduce((s, r) => s + r.available, 0),
  }))), [locations, current]);
  const { slice, pager, resetPage } = usePager(rows, 10);
  const pick = (key) => { setPicked(key); resetPage(); };
  const chipCls = (on) => `px-2.5 py-0.5 rounded-full border text-xs whitespace-nowrap transition-colors ${on ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"}`;

  return (
    <div className={SUB_WRAP}>
      <div className="flex flex-wrap gap-1.5 py-2">
        <button type="button" aria-pressed={!current} onClick={() => pick("")} className={chipCls(!current)}>Tất cả</button>
        {locations.map((x) => (
          <button key={x.key} type="button" aria-pressed={current === x.key} onClick={() => pick(x.key)} className={chipCls(current === x.key)}>
            {x.label}: {fmtByUnit(x.loc)}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="py-4 text-center text-sm text-slate-400">Không có hàng ở vị trí này</div>
      ) : (
        <>
          <div className={`hidden md:grid ${LOCATION_GRID} ${SUB_HEAD}`}>
            <div>Vị trí</div><div>Sản phẩm</div><div>Thông số</div><div>Lô</div>
            <div className="text-right">Tồn</div><div className="text-right">Khả dụng</div>
          </div>
          {slice.map((p) => (
            <div key={p.key} className={`${LOCATION_GRID} ${SUB_ROW}`}>
              <div className={`${CELL_TEXT} text-slate-500`}>{p.place}</div>
              <div className={`${CELL_TEXT} truncate`} title={p.product_name}>
                <span className="font-medium text-blue-600">{p.product_code}</span> <span className="text-slate-700">{p.product_name}</span>
              </div>
              <div className={`${CELL_TEXT} text-slate-700`}>{specShort(p.specs) || "—"}</div>
              <div className={`${CELL_TEXT} text-slate-700 truncate`}>{p.lots.length > 1 ? `${p.lots.length} lô` : (p.lots[0]?.lot_code || "(không lô)")}</div>
              <QtyCell quantity={p.total} unit={p.unit} className={CELL_QTY} />
              <AvailCell pending={p.pending} blocked={p.blocked} available={p.available} className={CELL_AVAIL} />
            </div>
          ))}
          {rows.length > 10 && <div className="pt-2">{pager}</div>}
        </>
      )}
    </div>
  );
}

function TreeTab({ lookups, viewMode, reloadKey }) {
  const [data, setData] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [q, setQ] = useRemembered("inv:tree:q", "");
  const [filterWh, setFilterWh] = useRemembered("inv:tree:wh", "");
  const [filterZone, setFilterZone] = useRemembered("inv:tree:zone", "");
  const [filterType, setFilterType] = useRemembered("inv:tree:type", "");
  const [openState, setOpenState] = useState(() => new Set());
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showZero, setShowZero] = useState(false); // mặc định ẩn các lô tồn 0

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventory.tree({});
      setData(res.data || res);
      setLoaded(true);
      setLoadError("");
    } catch (e) {
      setLoadError(e.message);
      toast.error("Lỗi tải tồn kho: " + e.message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const toggle = (key) => {
    setOpenState(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  const norm = (s) => (s || "").toString().toLowerCase();

  // Tồn theo sản phẩm + kho, tính trên toàn bộ dữ liệu: bộ lọc trên màn không được làm nhãn "Thiếu" báo sai
  const stockByProductWh = useMemo(() => {
    const m = new Map();
    for (const r of data) {
      if (!r.warehouse_id) continue;
      const k = r.product_id + "|" + r.warehouse_id;
      m.set(k, (m.get(k) || 0) + (Number(r.quantity) || 0));
    }
    return m;
  }, [data]);
  const shortagesOf = (productId, limits) => (limits || []).map((w) => ({
    warehouse_id: w.warehouse_id,
    min: Number(w.min_quantity),
    qty: stockByProductWh.get(productId + "|" + w.warehouse_id) || 0,
    set: w.min_quantity != null,
  })).filter((w) => w.set && w.qty < w.min);

  // Bước 1: Lọc dữ liệu phẳng
  const filteredData = data.filter(r => {
    // Lọc "dưới định mức" vẫn giữ lô tồn 0, nếu không sản phẩm đã hết sạch hàng sẽ biến mất khỏi danh sách cần mua
    if (!showZero && !(lowStockOnly && viewMode === "product") && Math.abs(Number(r.quantity) || 0) < 1e-9) return false;
    if (q && !norm(r.product_code).includes(norm(q)) && !norm(r.product_name).includes(norm(q)) && !norm(r.lot_code).includes(norm(q))) return false;
    if (filterWh && r.warehouse_id !== filterWh) return false;
    if (filterZone && r.zone_id !== filterZone) return false;
    if (filterType && r.product_type !== filterType) return false;
    return true;
  });

  // Bước 2: Gom nhóm theo Product
  const buildTreeByProduct = (rows) => {
    const zoneCount = new Map();
    (lookups.zones || []).forEach((z) => zoneCount.set(z.warehouse_id, (zoneCount.get(z.warehouse_id) || 0) + 1));
    const prods = new Map();
    for (const r of rows) {
      if (!prods.has(r.product_id)) {
        prods.set(r.product_id, {
          product_id: r.product_id, product_code: r.product_code, product_name: r.product_name,
          product_type: r.product_type, warehouse_limits: r.warehouse_limits || [], unit: r.unit, byUnit: {}, groups: new Map(),
        });
      }
      const P = prods.get(r.product_id);
      addUnit(P, r);
      if (!P.unit && r.unit) P.unit = r.unit;
      const gkey = r.spec_key || '';
      if (!P.groups.has(gkey)) P.groups.set(gkey, { spec_key: gkey, specs: r.specs || {}, byUnit: {}, lots: [] });
      const G = P.groups.get(gkey);
      addUnit(G, r);
      G.lots.push({
        id: r.id, lot_code: r.lot_order_code || r.lot_code || '', quantity: Number(r.quantity) || 0,
        unit: r.unit,
        // Kho chỉ có 1 khu thì ẩn tên khu cho đỡ lặp (giống bảng con của chế độ Theo vị trí)
        place: r.warehouse_name ? `${r.warehouse_name}${r.zone_name && zoneCount.get(r.warehouse_id) > 1 ? " · " + r.zone_name : ""}${r.location_name ? " · " + r.location_name : ""}` : "(chưa xác định)",
        pending: Number(r.pending) || 0, blocked: Number(r.blocked) || 0, available: Number(r.available) || 0,
        expiry_date: r.expiry_date,
      });
    }
    let arr = [...prods.values()].map((P) => ({
      ...P,
      shortages: shortagesOf(P.product_id, P.warehouse_limits),
      lotCount: [...P.groups.values()].reduce((s, g) => s + g.lots.length, 0),
      groups: [...P.groups.values()].sort((a, b) => (specShort(a.specs) || "").localeCompare(specShort(b.specs) || "", "vi", { numeric: true })),
    }));
    if (lowStockOnly) arr = arr.filter((p) => p.shortages.length > 0);
    return arr;
  };

  // Bước 3: Gom nhóm theo Location
  const buildTreeByLocation = (rows) => {
    const whs = new Map();
    // 1. Dựng sẵn cây từ danh mục để hiển thị cả những Khu/Vị trí trống (0 tồn)
    (lookups.warehouses || []).forEach(w => {
      whs.set(w.id, { id: w.id, name: w.name, byUnit: {}, zones: new Map() });
    });
    (lookups.zones || []).forEach(z => {
      if (whs.has(z.warehouse_id)) {
        whs.get(z.warehouse_id).zones.set(z.id, { id: z.id, name: z.name, byUnit: {}, locs: new Map() });
      }
    });
    (lookups.locations || []).forEach(l => {
      if (whs.has(l.warehouse_id)) {
        const W = whs.get(l.warehouse_id);
        if (l.zone_id && W.zones.has(l.zone_id)) {
          W.zones.get(l.zone_id).locs.set(l.id, { id: l.id, name: l.name, byUnit: {}, prods: new Map() });
        }
      }
    });

    // 2. Lấp dữ liệu tồn kho vào cây
    for (const r of rows) {
      const whId = r.warehouse_id || "unknown";
      if (!whs.has(whId)) whs.set(whId, { id: whId, name: r.warehouse_name || "(Chưa phân kho)", byUnit: {}, zones: new Map() });
      const W = whs.get(whId);
      addUnit(W, r);

      const znId = r.zone_id || "unknown";
      if (!W.zones.has(znId)) W.zones.set(znId, { id: znId, name: r.zone_name || "(Không phân khu)", byUnit: {}, locs: new Map() });
      const Z = W.zones.get(znId);
      addUnit(Z, r);

      const locId = r.location_id || "unknown";
      if (!Z.locs.has(locId)) Z.locs.set(locId, { id: locId, name: r.location_name || "(Không có vị trí)", byUnit: {}, prods: new Map() });
      const L = Z.locs.get(locId);
      addUnit(L, r);

      const pkey = r.product_id + '|' + (r.spec_key || '');
      if (!L.prods.has(pkey)) L.prods.set(pkey, {
        product_id: r.product_id, product_code: r.product_code, product_name: r.product_name, specs: r.specs, spec_key: r.spec_key || '', unit: r.unit, total: 0, lots: [],
      });
      const P = L.prods.get(pkey);
      P.total += Number(r.quantity) || 0;
      P.lots.push({
        lot_code: r.lot_order_code || r.lot_code || '',
        pending: Number(r.pending) || 0, blocked: Number(r.blocked) || 0, available: Number(r.available) || 0,
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

    // Đang tìm kiếm hoặc lọc theo loại thì ẩn các vị trí trống cho đỡ rối
    if (q || filterType) {
      arr.forEach(w => {
        w.zones.forEach(z => {
          z.locs = z.locs.filter(l => l.prods.length > 0);
        });
        w.zones = w.zones.filter(z => z.locs.length > 0);
      });
      arr = arr.filter(w => w.zones.length > 0);
    }

    return arr;
  };

  const zonesList = filterWh ? (lookups.zones || []).filter(z => z.warehouse_id === filterWh) : (lookups.zones || []);
  const typeOptions = useMemo(() => [...new Set(data.map((r) => r.product_type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), [data]);
  const emptyBox = (text) => <div className="px-4 py-10 text-center text-slate-400 text-sm">{text}</div>;

  const renderProductView = () => {
    const tree = buildTreeByProduct(filteredData);
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className={TREE_HEAD}>
          <div>Sản phẩm</div>
          <div className="hidden md:block">Chi tiết</div>
          <div className="text-right">Tồn</div>
        </div>
        {tree.length === 0 && emptyBox("Chưa có tồn kho phù hợp")}
        {tree.map(p => {
          const pOpen = openState.has("P" + p.product_id);
          const detail = `${p.groups.length} nhóm · ${p.lotCount} lô`;
          const first = p.shortages[0];
          const whNameOf = (id) => lookups?.warehouses?.find((x) => x.id === id)?.name || "Kho";
          return (
            <div key={p.product_id} className="border-b border-slate-100 last:border-0">
              <button type="button" aria-expanded={pOpen} onClick={() => toggle("P" + p.product_id)} className={TREE_TOGGLE}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                  <Chevron open={pOpen} />
                  <span className="font-medium text-blue-600 shrink-0">{p.product_code}</span>
                  <span className="text-slate-700 truncate flex-1 md:flex-initial min-w-0">{p.product_name}</span>
                  <span className={`hidden md:inline-flex shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(p.product_type)}`}>{p.product_type}</span>
                  {first && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700"
                      title={p.shortages.map((w) => `${whNameOf(w.warehouse_id)}: tối thiểu ${fmt(w.min)}, thực tế ${fmt(w.qty)}`).join("\n")}>
                      Thiếu {fmt(first.min - first.qty)} {p.unit} tại {whNameOf(first.warehouse_id)}{p.shortages.length > 1 ? ` +${p.shortages.length - 1}` : ""}
                    </span>
                  )}
                  <span className="md:hidden w-full pl-6 text-xs text-slate-500">{p.product_type} · {detail}</span>
                </div>
                <div className="hidden md:block text-sm text-slate-500">{detail}</div>
                <div className="text-right tabular-nums"><QtyByUnit o={p} /></div>
              </button>
              {pOpen && <ProductLots p={p} />}
            </div>
          );
        })}
      </div>
    );
  };

  const renderLocationView = () => {
    const tree = buildTreeByLocation(filteredData);
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className={TREE_HEAD}>
          <div>Kho</div>
          <div className="hidden md:block">Chi tiết</div>
          <div className="text-right">Tồn</div>
        </div>
        {tree.length === 0 && emptyBox("Chưa có tồn kho phù hợp")}
        {tree.map(w => {
          const wOpen = openState.has("W" + w.id);
          const detail = `${w.zones.length} khu · ${w.zones.reduce((s, z) => s + z.locs.length, 0)} vị trí`;
          return (
            <div key={w.id} className="border-b border-slate-100 last:border-0">
              <button type="button" aria-expanded={wOpen} onClick={() => toggle("W" + w.id)} className={TREE_TOGGLE}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                  <Chevron open={wOpen} />
                  <span className="font-semibold text-slate-800 truncate flex-1 md:flex-initial min-w-0">{w.name}</span>
                  <span className="md:hidden w-full pl-6 text-xs text-slate-500">{detail}</span>
                </div>
                <div className="hidden md:block text-sm text-slate-500">{detail}</div>
                <div className="text-right tabular-nums"><QtyByUnit o={w} /></div>
              </button>
              {wOpen && <WarehouseRows w={w} />}
            </div>
          );
        })}
      </div>
    );
  };

  const selectCls = `${inputCls} flex-1 min-w-0 md:flex-none md:w-[140px]`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap md:flex-nowrap items-center gap-2">
        <input aria-label="Tìm sản phẩm hoặc lô" className={`${inputCls} basis-full md:basis-auto flex-1 min-w-0 w-auto`} placeholder="Tìm SP / Lô…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Lọc theo kho" className={selectCls} value={filterWh} onChange={e => { setFilterWh(e.target.value); setFilterZone(""); }}>
          <option value="">Kho: Tất cả</option>
          {(lookups.warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select aria-label="Lọc theo khu" className={selectCls} value={filterZone} onChange={e => setFilterZone(e.target.value)}>
          <option value="">Khu: Tất cả</option>
          {zonesList.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <select aria-label="Lọc theo loại sản phẩm" className={selectCls} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">Loại: Tất cả</option>
          {typeOptions.map((t) => <option key={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} className="w-4 h-4 accent-slate-500" />
          Hiện lô 0
        </label>
        {viewMode === "product" && (
          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} className="w-4 h-4 accent-rose-600" />
            Dưới định mức
          </label>
        )}
      </div>

      {!loaded && loadError ? <LoadError message={`Không tải được tồn kho: ${loadError}`} onRetry={load} />
        : !loaded && loading ? <div className="bg-white rounded-xl border border-slate-200">{emptyBox("Đang tải…")}</div>
        : viewMode === "product" ? renderProductView() : renderLocationView()}
    </div>
  );
}


/* ---- Tab: Lịch sử giao dịch kho ---- */
function TransactionsTab({ reloadKey }) {
  const [rows, setRows] = useState([]);
  const [range, setRange] = useRemembered("inv:trx:range", defaultRange);
  const [listLoading, setListLoading] = useState(true);
  const load = useCallback(async () => {
    setListLoading(true); try { setRows(await inventory.transactions({ ...range, limit: 2000 })); } catch (e) { toast.error("Lỗi tải lịch sử: " + e.message); } finally { setListLoading(false); }
  }, [range]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const columns = [
    { key: "created_at", label: "Thời gian", filter: "date", tdClass: "text-slate-500", render: (t) => fmtDateTime(t.created_at) },
    { key: "trx_type", label: "Loại", filter: "select", render: (t) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${TRX_COLOR[t.trx_type] || ""}`}>{t.trx_type}</span> },
    { key: "product_code", label: "Mã SP", filter: "text", tdClass: "font-medium text-blue-600" },
    { key: "product_name", label: "Sản phẩm", filter: "select", tdClass: "text-slate-800" },
    { key: "_specs", label: "Thông số", filter: "text", tdClass: "text-slate-500",
      filterValue: (t) => specShort(t.specs),
      render: (t) => specShort(t.specs) || "—" },
    { key: "lot_code", label: "Lô", filter: "text", tdClass: "text-slate-600", render: (t) => t.lot_code || "—" },
    { key: "quantity", label: "Số lượng", align: "right", render: (t) => <span className={`font-semibold ${trxIsIn(t) ? "text-emerald-600" : "text-rose-600"}`}>{trxIsIn(t) ? "+" : "−"}{fmt(t.quantity)}</span> },
    { key: "warehouse_name", label: "Kho/Vị trí", filter: "select", tdClass: "text-slate-600", render: (t) => t.warehouse_name ? `${t.warehouse_name} · ${t.location_name}` : "—" },
    { key: "ref_code", label: "Chứng từ", filter: "text", tdClass: "text-slate-600", render: (t) => t.ref_code || "—" },
    byColumn,
    { key: "note", label: "Ghi chú", filter: "text", tdClass: "text-slate-400", render: (t) => t.note || "" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><TrxRange value={range} onChange={setRange} /></div>
      <DataTable loading={listLoading} dense columns={columns} rows={rows} rowKey={(t) => t.id} emptyText="Chưa có giao dịch" />
    </div>
  );
}

/* ---- Hub Kho ---- */
export default function InventoryModule({ lookups }) {
  const [tab, setTab] = useRemembered("inv:tab", "stock");
  const [viewMode, setViewMode] = useRemembered("inv:tree:view", "product"); // "product" | "location"
  const [reloadKey, setReloadKey] = useState(0);
  const tabs = [
    { key: "stock", label: "Tồn kho" },
    { key: "trx", label: "Lịch sử giao dịch" },
  ];

  return (
    <div className="space-y-4">
      <ListHeader title="Tồn kho" actions={
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="btn-ghost"><RotateCcw size={16} aria-hidden="true" /> Làm mới</button>
      } />
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-slate-200">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
                tab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === "stock" && (
          <div className="flex gap-1 w-full md:w-auto py-1.5">
            {[["location", "Theo vị trí"], ["product", "Theo sản phẩm"]].map(([key, label]) => (
              <button key={key} type="button" aria-pressed={viewMode === key} onClick={() => setViewMode(key)}
                className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors ${viewMode === key ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {tab === "stock" ? <TreeTab lookups={lookups} viewMode={viewMode} reloadKey={reloadKey} /> : <TransactionsTab reloadKey={reloadKey} />}
    </div>
  );
}
