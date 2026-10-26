import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, X, CalendarDays } from "lucide-react";
import { inputCls, UNITS, fmt, statusClass } from "./ui.js";

// Bỏ dấu tiếng Việt để tìm không phân biệt dấu/hoa-thường
const stripVN = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

/**
 * Dropdown có Ô TÌM KIẾM (combobox): gõ vài ký tự → lọc gợi ý (không phân biệt dấu).
 * options: [{ value, label }]. onChange(value).
 */
export function SearchSelect({ value, onChange, options = [], placeholder = "-- Chọn --", disabled = false, className, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0); // C-04: mục đang trỏ bằng phím ↑↓
  const [pos, setPos] = useState(null);           // toạ độ để đặt menu (portal, fixed)
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selected = options.find((o) => o.value === value);
  const filtered = q ? options.filter((o) => stripVN(o.label).includes(stripVN(q))) : options;

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    if (spaceBelow < 250 && spaceAbove > spaceBelow) {
      setPos({ left: r.left, bottom: window.innerHeight - r.top + 4, width: r.width, maxHeight: Math.min(300, spaceAbove - 16) });
    } else {
      setPos({ left: r.left, top: r.bottom + 4, width: r.width, maxHeight: Math.min(300, spaceBelow - 16) });
    }
  };
  const openMenu = () => {
    if (disabled) return;
    place(); setOpen(true);
    setActiveIdx(Math.max(0, options.findIndex((o) => o.value === value)));
  };
  const close = (refocus) => { setOpen(false); setQ(""); if (refocus) triggerRef.current?.focus(); };
  // ↑↓ di chuyển, Enter chọn, Esc đóng (trả focus về nút), Tab đóng
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      const n = e.key === "ArrowDown" ? Math.min(filtered.length - 1, activeIdx + 1) : Math.max(0, activeIdx - 1);
      setActiveIdx(n);
      menuRef.current?.querySelector(`[data-idx="${n}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[activeIdx]; if (o) { onChange(o.value); close(true); }
    } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") close(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false); setQ("");
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const pick = (v) => { onChange(v); setOpen(false); setQ(""); };
  return (
    <>
      <button type="button" ref={triggerRef} disabled={disabled} onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); openMenu(); } }}
        className={(className || inputCls) + " text-left flex items-center justify-between gap-2" + (disabled ? " bg-slate-50 text-slate-400" : "")}>
        <span className={"truncate " + (selected ? "" : (disabled ? "text-transparent" : "text-slate-400"))}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className={"shrink-0 " + (disabled && !selected ? "text-transparent" : "text-slate-400")} />
      </button>
      {open && !disabled && pos && createPortal(
        <div ref={menuRef} style={{ position: "fixed", left: pos.left, ...(pos.top ? { top: pos.top } : { bottom: pos.bottom }), width: "max-content", minWidth: pos.width, maxWidth: 350, maxHeight: pos.maxHeight || 288, zIndex: 1000 }}
          className="bg-white border border-slate-200 rounded-lg shadow-lg overflow-auto flex flex-col">
          <div className="p-2 sticky top-0 bg-white border-b border-slate-100">
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }} onKeyDown={onKeyDown} placeholder="Gõ để tìm…" size={1}
              aria-label={ariaLabel ? `Tìm ${ariaLabel}` : "Gõ để tìm"}
              className="w-full min-w-[50px] px-2 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          </div>
          <div className="py-1" role="listbox" aria-label={ariaLabel}>
            {!filtered.length && <div className="px-3 py-2 text-sm text-slate-400">Không tìm thấy</div>}
            {filtered.map((o, i) => (
              <button type="button" key={o.value} onClick={() => pick(o.value)} tabIndex={-1}
                role="option" aria-selected={o.value === value} data-idx={i} onMouseEnter={() => setActiveIdx(i)}
                className={"w-full text-left truncate px-3 py-1.5 text-xs hover:bg-blue-50 " + (o.value === value ? "bg-blue-50 text-blue-700 font-medium " : "text-slate-700 ") + (i === activeIdx ? "ring-1 ring-inset ring-blue-300" : "")}
                title={o.label}>
                {o.label}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/**
 * Dropdown chọn Đơn vị tính (thay ô nhập tự do). Luôn giữ giá trị cũ ngoài danh mục
 * (vd dữ liệu cũ) để không mất dữ liệu.
 */
/* Chống bấm Lưu nhiều lần: const [saving, guard] = useSaving(); <button onClick={() => guard(save)} disabled={saving}>
   ref chặn ngay lần bấm thứ 2 (state chưa kịp cập nhật), state để đổi nhãn "Đang lưu…" */
export function useSaving() {
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const guard = async (fn) => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try { return await fn(); } finally { busy.current = false; setSaving(false); }
  };
  return [saving, guard];
}

export function UnitSelect({ value, onChange, disabled = false, className }) {
  const v = value || "";
  const opts = v && !UNITS.includes(v) ? [v, ...UNITS] : UNITS;
  return (
    <select className={className || inputCls} disabled={disabled} value={v} onChange={(e) => onChange(e.target.value)}>
      <option value="">-- Đơn vị --</option>
      {opts.map((u) => <option key={u} value={u}>{u}</option>)}
    </select>
  );
}

/**
 * Logo Ngọc An Thư (SVG) — dùng chung cho sidebar, đăng nhập, và mọi biểu mẫu in.
 * Vẽ vector nên nét ở mọi kích thước & khi xuất PDF.
 *  - light: chữ trắng (đặt trên nền tối).
 *  - withText: kèm chữ "NGỌC AN THƯ" (false = chỉ biểu tượng).
 */
// Dùng đúng file ảnh logo gốc tại public/logo.png — thay file là đổi logo toàn hệ thống.
export function Logo({ className = "" }) {
  return <img src="/logo.png" alt="Ngọc An Thư" className={className} />;
}

/**
 * Thanh header trang: breadcrumb/back + tiêu đề + (badge) + nút hành động.
 * Tràn ra mép vùng nội dung (bù padding p-8 của <main>), dính trên cùng,
 * có viền dưới để phân cách rõ với phần trường thông tin bên dưới.
 */
export function PageHeader({ title, subtitle, badge, onBack, backLabel = "Quay lại", actions }) {
  return (
    <div className="sticky -top-4 md:-top-8 z-10 -mx-4 md:-mx-8 -mt-4 md:-mt-8 mb-4 md:mb-6 px-4 md:px-8 pt-4 md:pt-5 pb-3 md:pb-4 glass-panel border-x-0 border-t-0 shadow-sm">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm mb-2">
          <ArrowLeft size={16} /> {backLabel}
        </button>
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">{title}</h1>
          {badge}
          {subtitle && <span className="text-slate-400 text-sm">{subtitle}</span>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Header màn danh sách: tiêu đề + nút hành động, dính trên cùng vùng nội dung
 * (bù padding p-8 của <main>), nền theo nền trang để che nội dung cuộn phía dưới.
 */
export function ListHeader({ title, subtitle, actions }) {
  return (
    <div className="sticky -top-4 md:-top-8 z-20 -mx-4 md:-mx-8 -mt-4 md:-mt-8 mb-4 md:mb-5 px-4 md:px-8 pt-4 md:pt-5 pb-3 md:pb-4 glass-panel border-x-0 border-t-0 shadow-sm">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">{title}</h1>
          {subtitle && <span className="text-slate-400 text-sm">{subtitle}</span>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Khối section: header (tiêu đề + hành động phụ) có viền dưới phân cách,
 * thân nội dung padding riêng — mỗi section nhìn tách bạch.
 */
export function Section({ title, action, children, bodyClass = "p-6", className = "", collapsible = true, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const canToggle = collapsible && !!title;
  return (
    <div className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${className}`}>
      {title && (
        <div className={`flex items-center justify-between px-6 py-3.5 bg-slate-50/50 ${open ? "border-b border-slate-100" : ""}`}>
          {canToggle ? (
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 -ml-1 group">
              <ChevronDown size={16} className={`text-slate-400 group-hover:text-slate-600 transition-transform ${open ? "" : "-rotate-90"}`} />
              <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
            </button>
          ) : (
            <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          )}
          {open && action}
        </div>
      )}
      {open && <div className={bodyClass}>{children}</div>}
    </div>
  );
}

/* ---- Phân trang dùng chung ---- */
const PAGE_SIZES = [10, 15, 20];

function pageNumbers(page, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out = [1];
  const l = Math.max(2, page - 1), r = Math.min(count - 1, page + 1);
  if (l > 2) out.push("…");
  for (let i = l; i <= r; i++) out.push(i);
  if (r < count - 1) out.push("…");
  out.push(count);
  return out;
}

const pagerBtn = "min-w-[32px] h-8 px-2 inline-flex items-center justify-center rounded-md border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition";

export function Pagination({ total, page, size, pageCount, start, onPage, onSize, sizes = PAGE_SIZES }) {
  if (!total) return null;
  const from = start + 1, to = Math.min(start + size, total);
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span>Hiển thị</span>
        <select value={size} onChange={(e) => onSize(+e.target.value)} aria-label="Số dòng mỗi trang"
          className="rounded-md border border-slate-300 px-2 py-1 text-sm">
          {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span>dòng · {from}–{to} / {total}</span>
      </div>
      <div className="flex items-center gap-1">
        <button className={pagerBtn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước"><ChevronLeft size={16} /></button>
        {pageNumbers(page, pageCount).map((n, i) =>
          n === "…"
            ? <span key={`e${i}`} className="px-1.5 text-slate-400">…</span>
            : <button key={n} onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined} aria-label={`Trang ${n}`}
                className={`${pagerBtn} ${n === page ? "!bg-blue-600 !text-white !border-blue-600" : ""}`}>{n}</button>)}
        <button className={pagerBtn} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Trang sau"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

/**
 * Hook phân trang: nhận mảng dữ liệu, trả về `slice` (dòng của trang hiện tại)
 * và `Pager` (component thanh phân trang đã gắn sẵn state). Mặc định 10 dòng/trang.
 */
/* Nhớ bộ lọc / trang của màn danh sách khi mở chi tiết rồi Quay lại (kể cả sang module khác rồi về).
   Lưu trong bộ nhớ của tab trình duyệt (tải lại trang F5 thì về mặc định). Dùng như useState:
   const [q, setQ] = useRemembered("orders:q", "");   key = null → như useState thường */
const _remembered = new Map();
export function useRemembered(key, initial) {
  const [v, setV] = useState(() => (key && _remembered.has(key)) ? _remembered.get(key)
    : (typeof initial === "function" ? initial() : initial));
  const set = React.useCallback((next) => setV((prev) => {
    const val = typeof next === "function" ? next(prev) : next;
    if (key) _remembered.set(key, val);
    return val;
  }), [key]);
  return [v, set];
}

export function usePager(rows, initialSize = 10, sizes, stateKey = null) {
  const [size, setSize] = useRemembered(stateKey && stateKey + ":size", initialSize);
  const [page, setPage] = useRemembered(stateKey && stateKey + ":page", 1);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  // rows rỗng lúc đang tải lại → đừng kéo trang đã nhớ về 1
  useEffect(() => { if (total > 0 && page > pageCount) setPage(pageCount); }, [pageCount]); // eslint-disable-line
  const start = (page - 1) * size;
  const slice = rows.slice(start, start + size);
  // C-06: `pager` / `filler(cols)` là element dựng sẵn (KHÔNG phải component mới mỗi lần vẽ → không mất focus).
  // `Pager` / `Filler` giữ lại cho chỗ cũ còn dùng <Pager /> / <Filler cols />.
  const pager = (
    <Pagination total={total} page={page} size={size} pageCount={pageCount}
      start={start} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} sizes={sizes} />
  );
  // Hàng trống lấp đầy để bảng luôn cao đúng `size` dòng → thanh phân trang không nhảy.
  const fillCount = total > 0 ? Math.max(0, size - slice.length) : 0;
  const filler = (cols) => fillCount === 0 ? null : (
    <>{Array.from({ length: fillCount }).map((_, i) => (
      <tr key={`__filler${i}`} aria-hidden="true">
        <td colSpan={cols} className="px-4 py-3">&nbsp;</td>
      </tr>
    ))}</>
  );
  const Pager = () => pager;
  const Filler = ({ cols }) => filler(cols);
  const resetPage = () => setPage(1);
  return { slice, pager, filler, Pager, Filler, resetPage };
}

/* ---- Bảng dữ liệu có bộ lọc theo từng cột ---- */
// Bỏ dấu tiếng Việt để lọc "gần đúng"
const stripAccent = (s) => String(s ?? "").toLowerCase().normalize("NFD")
.replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

const alignCls = (a) => a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";

// Ô ngày luôn hiện dd/mm/yyyy (ô date gốc của trình duyệt hiện theo ngôn ngữ máy, vd mm/dd/yyyy).
// Giá trị vào/ra vẫn là "yyyy-MM-dd", onChange nhận { target: { value } } như ô input thường.
const ymdToDmy = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const dmyToYmd = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return d.getDate() === +m[1] && d.getMonth() === +m[2] - 1 ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
export function DateInput({ value, onChange, placeholder = "dd/mm/yyyy", className, min, max, disabled, ...props }) {
  const [text, setText] = useState(ymdToDmy(value));
  const pickerRef = useRef(null);
  useEffect(() => { setText(ymdToDmy(value)); }, [value]);
  const emit = (v) => onChange?.({ target: { value: v } });
  const onType = (e) => {
    // Chỉ giữ chữ số, tự chèn dấu "/" → gõ 21102026 thành 21/10/2026
    const dg = e.target.value.replace(/\D/g, "").slice(0, 8);
    const t = [dg.slice(0, 2), dg.slice(2, 4), dg.slice(4)].filter(Boolean).join("/");
    setText(t);
    if (!t) return emit("");
    const ymd = dmyToYmd(t);
    if (ymd && (!min || ymd >= min) && (!max || ymd <= max)) emit(ymd);
  };
  return (
    <div className="relative">
      <input type="text" inputMode="numeric" placeholder={placeholder} value={text} onChange={onType}
        onBlur={() => setText(ymdToDmy(value))} disabled={disabled} className={(className || "") + " pr-8"} {...props} />
      <button type="button" tabIndex={-1} disabled={disabled} title="Chọn ngày"
        onClick={() => { try { pickerRef.current?.showPicker(); } catch { pickerRef.current?.focus(); } }}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 disabled:opacity-40">
        <CalendarDays size={15} />
      </button>
      <input ref={pickerRef} type="date" tabIndex={-1} aria-hidden="true" value={value || ""} min={min} max={max}
        onChange={(e) => emit(e.target.value)} className="absolute right-0 bottom-0 w-0 h-0 opacity-0 pointer-events-none" />
    </div>
  );
}

/**
 * Bảng dùng chung: có hàng bộ lọc ngay trên hàng tiêu đề cột.
 * columns: [{ key, label, filter?: 'text'|'select'|'date', filterValue?(row), filterKey?,
 *             render?(row), align?, tdClass? }]
 * Lọc nhiều cột cùng lúc (AND), text = gần đúng (bỏ dấu), tự cập nhật danh sách.
 */
export function DataTable({ columns, rows, rowKey, pageSize = 10, emptyText = "Không có dữ liệu", dense = false, stateKey, loading = false }) {
  // Bộ lọc + trang được nhớ theo màn hình (đường dẫn + bộ cột) → Quay lại từ chi tiết vẫn giữ lọc
  const memKey = stateKey ?? `dt:${window.location.pathname}:${columns.map((c) => c.key).join(",")}`;
  const [filters, setFilters] = useRemembered(memKey + ":filters", {});
  // C-05: đổi bộ lọc → về trang 1 (lúc mở lại màn vẫn giữ trang đã nhớ — chỉ reset khi người dùng lọc)
  const resetPageRef = useRef(null);
  const setF = (k, v) => { setFilters((s) => ({ ...s, [k]: v })); resetPageRef.current?.(); };
  const cellValue = (c, r) => c.filterValue ? c.filterValue(r) : r[c.filterKey || c.key];

  const distinct = (c) => {
    if (c.options) return c.options;
    const set = new Set();
    rows.forEach((r) => { const v = cellValue(c, r); if (v !== null && v !== undefined && v !== "") set.add(String(v)); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  };

  const filtered = rows.filter((r) => columns.every((c) => {
    if (!c.filter) return true;
    const fv = filters[c.key];
    if (!fv) return true;
    const cell = cellValue(c, r);
    if (c.filter === "select") return String(cell ?? "") === fv;
    if (c.filter === "date") return String(cell ?? "").slice(0, 10) === fv;
    return stripAccent(cell).includes(stripAccent(fv));
  }));

  const { slice, pager, filler, resetPage } = usePager(filtered, pageSize, undefined, memKey);
  resetPageRef.current = resetPage;
  const pad = dense ? "px-3 py-2" : "px-4 py-3";
  const inputCls = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 disabled:placeholder-transparent focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none";

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="bg-slate-50/70 border-b border-slate-100">
              {columns.map((c) => (
                <th key={c.key} className={`${pad} align-top font-normal`} style={c.minWidth ? { minWidth: c.minWidth } : {}}>
                  {c.filter === "select" ? (
                    <SearchSelect
                      value={filters[c.key] || ""}
                      onChange={(v) => setF(c.key, v === "__all__" ? "" : v)}
                      placeholder={c.label} ariaLabel={"Lọc " + c.label}
                      className={inputCls + " bg-white"}
                      options={[{ value: "__all__", label: "— Tất cả —" }, ...distinct(c).map((v) => ({ value: String(v), label: String(v) }))]}
                    />
                  ) : c.filter === "date" ? (
                    <DateInput value={filters[c.key] || ""} onChange={(e) => setF(c.key, e.target.value)} className={inputCls} placeholder={c.label} aria-label={"Lọc " + c.label} />
                  ) : c.filter === "text" ? (
                    <input value={filters[c.key] || ""} onChange={(e) => setF(c.key, e.target.value)} placeholder={c.label} aria-label={"Lọc " + c.label} className={inputCls} />
                  ) : null}
                </th>
              ))}
            </tr>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {columns.map((c) => <th key={c.key} className={`${pad} font-semibold ${alignCls(c.align)}`}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody className={"divide-y divide-slate-100" + (loading && rows.length ? " opacity-60 transition-opacity" : "")} aria-busy={loading || undefined}>
            {slice.map((r) => (
              <tr key={rowKey(r)} className="hover:bg-slate-50/70">
                {columns.map((c) => (
                  <td key={c.key} className={`${pad} ${alignCls(c.align)}${c.align === "right" ? " tabular-nums" : ""} ${c.tdClass || "text-slate-700"}`}>
                    {c.render ? c.render(r) : (r[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={columns.length} className={`${pad} py-10 text-center text-slate-400`}>{loading && !rows.length ? "Đang tải…" : emptyText}</td></tr>}
            {filler(columns.length)}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}

/* ---- Hộp thoại dùng chung (G-03) ----
   useDialog: Esc để đóng, focus vào hộp khi mở + trả focus khi đóng, khóa cuộn nền,
   có thay đổi chưa lưu (dirty) thì hỏi trước khi đóng. requestClose() dùng cho nút Hủy / × / nền.
   locked = đang xử lý (vd đang nhập Excel) → không cho đóng. */
export function useDialog({ open = true, onClose, dirty, locked = false, labelledBy }) {
  const ref = useRef(null);
  // dirty không truyền → tự coi là có thay đổi khi người dùng gõ / chọn trong hộp (onChangeCapture)
  const touched = useRef(false);
  const st = useRef({}); st.current = { onClose, dirty, locked };
  const requestClose = React.useCallback(() => {
    const { onClose: oc, dirty: d, locked: l } = st.current;
    if (l) return;
    if ((d ?? touched.current) && !window.confirm("Bỏ thay đổi chưa lưu?")) return;
    oc?.();
  }, []);
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      (el.querySelector("[autofocus], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])") || el).focus?.();
    }, 0);
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); requestClose(); } };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, requestClose]);
  // gắn vào khung hộp có sẵn: <div {...dialogProps}> (giữ nguyên giao diện cũ)
  const dialogProps = { ref, role: "dialog", "aria-modal": "true", "aria-labelledby": labelledBy, tabIndex: -1,
    onChangeCapture: () => { touched.current = true; }, style: { outline: "none" } };
  return { ref, requestClose, dialogProps };
}

const MODAL_SIZES = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl", "2xl": "max-w-6xl" };
let _dlgSeq = 0;
/** Hộp thoại giữa màn hình. Mặc định bấm nền KHÔNG đóng (closeOnBackdrop=false) để không mất dữ liệu đang nhập.
 *  children có thể là hàm (requestClose) => … để nút Hủy trong thân hộp cũng đi qua bước hỏi dirty. */
export function Modal({ open = true, title, onClose, dirty, locked = false, closeOnBackdrop = false, size = "lg", footer, children, bodyClass = "p-5", className = "", z = "z-50" }) {
  const { requestClose, dialogProps } = useDialog({ open, onClose, dirty, locked });
  const [titleId] = useState(() => `dlg-title-${++_dlgSeq}`);
  if (!open) return null;
  return (
    <div className={`fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 ${z}`}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) requestClose(); }}>
      <div {...dialogProps} aria-labelledby={title ? titleId : undefined}
        className={`bg-white rounded-xl shadow-xl w-full ${MODAL_SIZES[size] || size} max-h-[90vh] flex flex-col outline-none ${className}`}>
        {title != null && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
            <h3 id={titleId} className="font-semibold text-slate-800">{title}</h3>
            <button type="button" onClick={requestClose} disabled={locked} aria-label="Đóng" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"><X size={18} /></button>
          </div>
        )}
        <div className={`flex-1 overflow-y-auto ${bodyClass}`}>{typeof children === "function" ? children(requestClose) : children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 shrink-0">{typeof footer === "function" ? footer(requestClose) : footer}</div>}
      </div>
    </div>
  );
}

/** G-05: khối báo lỗi tải + nút Thử lại (thay cho việc kẹt mãi ở "Đang tải…") */
export function LoadError({ message = "Không tải được dữ liệu", onRetry, className = "" }) {
  return (
    <div role="alert" className={`flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 ${className}`}>
      {/* lỗi mạng của trình duyệt (tiếng Anh) → nói rõ bằng tiếng Việt */}
      <span>{String(message).replace(/Failed to fetch|NetworkError[^)]*|Load failed/g, "không kết nối được máy chủ")}</span>
      {onRetry && <button type="button" onClick={onRetry} className="btn-ghost py-1 text-sm">Thử lại</button>}
    </div>
  );
}

/* ---- Gắn hành vi hộp thoại vào KHUNG CÓ SẴN (không đổi giao diện) ----
   Đặt <DialogBehavior onClose={…} /> làm con đầu tiên của khung hộp: khung được gắn role="dialog",
   Esc để đóng, focus vào ô đầu khi mở / trả focus khi đóng, khóa cuộn nền, tự đánh dấu "có thay đổi"
   khi người dùng gõ / chọn trong hộp. Nút Hủy / × gọi confirmClose(e, đóng) để cũng được hỏi.
   dirty (tùy chọn) = ghi đè cách tự đánh dấu; locked = đang xử lý, không cho đóng. */
export function DialogBehavior({ onClose, dirty, locked = false }) {
  const spanRef = useRef(null);
  const st = useRef({}); st.current = { onClose, dirty, locked };
  useEffect(() => {
    const el = spanRef.current?.parentElement;
    if (!el) return;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.style.outline = "none";
    const h = el.querySelector("h1, h2, h3");
    if (h) { if (!h.id) h.id = `dlg-h-${++_dlgSeq}`; el.setAttribute("aria-labelledby", h.id); }
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      if (el.contains(document.activeElement)) return;
      (el.querySelector("input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])") || el).focus?.({ preventScroll: true });
    }, 0);
    const mark = () => { if (st.current.dirty === undefined) el.dataset.dirty = "1"; };
    el.addEventListener("input", mark); el.addEventListener("change", mark);
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const all = document.querySelectorAll('[role="dialog"]');
      if (all[all.length - 1] !== el) return; // chỉ hộp trên cùng
      e.preventDefault();
      confirmClose({ currentTarget: el }, () => st.current.onClose?.());
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      el.removeEventListener("input", mark); el.removeEventListener("change", mark);
      document.removeEventListener("keydown", onKey);
      // gỡ thuộc tính đã gắn (khung có thể vẫn nằm trong trang, vd ngăn kéo chỉ trượt ra ngoài)
      ["role", "aria-modal", "aria-labelledby"].forEach((k) => el.removeAttribute(k));
      delete el.dataset.dirty; delete el.dataset.locked;
      document.body.style.overflow = prevOverflow;
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const el = spanRef.current?.parentElement; if (!el) return;
    if (dirty !== undefined) { if (dirty) el.dataset.dirty = "1"; else delete el.dataset.dirty; }
    if (locked) el.dataset.locked = "1"; else delete el.dataset.locked;
  });
  return <span ref={spanRef} hidden />;
}

/** Đóng hộp thoại có kiểm tra: đang khóa → bỏ qua; có thay đổi chưa lưu → hỏi. e = sự kiện bấm nút trong hộp. */
export function confirmClose(e, close) {
  const el = e?.currentTarget?.closest ? e.currentTarget.closest('[role="dialog"]') : null;
  if (el?.dataset.locked) return;
  if (el?.dataset.dirty && !window.confirm("Bỏ thay đổi chưa lưu?")) return;
  close?.();
}

/* ---- Chip lệnh SX + tiến độ Thổi / Cắt (dùng ở Đơn hàng, Phiếu giao) ----
   o: { id, order_code, status, blow_plan, blow_done, cut_plan, cut_done } — từ backend lsxProgressByItems */
export function LsxProgressChip({ o, onOpen }) {
  const stage = (label, done, plan) => {
    if (!(Number(plan) > 0)) return null;
    const ok = Number(done) >= Number(plan) - 1e-6;
    return <span className={ok ? "text-emerald-600" : "text-slate-500"}>{label} {fmt(done)}/{fmt(plan)}{ok ? " ✓" : ""}</span>;
  };
  const blow = stage("Thổi", o.blow_done, o.blow_plan);
  const cut = stage("Cắt", o.cut_done, o.cut_plan);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs whitespace-nowrap">
      {onOpen
        ? <a href="#" onClick={(e) => { e.preventDefault(); onOpen(o.id); }} className="font-semibold text-blue-600 hover:underline" title="Mở lệnh sản xuất">{o.order_code}</a>
        : <span className="font-semibold text-slate-700">{o.order_code}</span>}
      {blow && <><span className="text-slate-300">·</span>{blow}</>}
      {cut && <><span className="text-slate-300">·</span>{cut}</>}
      {!blow && !cut && <span className="text-slate-400">Chưa phân công</span>}
      <span className={"px-1.5 py-0.5 rounded-full text-[10px] " + statusClass(o.status)}>{o.status}</span>
    </span>
  );
}
