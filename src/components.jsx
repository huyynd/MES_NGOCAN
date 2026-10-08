import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { inputCls, UNITS } from "./ui.js";

// Bỏ dấu tiếng Việt để tìm không phân biệt dấu/hoa-thường
const stripVN = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

/**
 * Dropdown có Ô TÌM KIẾM (combobox): gõ vài ký tự → lọc gợi ý (không phân biệt dấu).
 * options: [{ value, label }]. onChange(value).
 */
export function SearchSelect({ value, onChange, options = [], placeholder = "-- Chọn --", disabled = false, className }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
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
  const openMenu = () => { if (disabled) return; place(); setOpen(true); };

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
        className={(className || inputCls) + " text-left flex items-center justify-between gap-2" + (disabled ? " bg-slate-50 text-slate-400" : "")}>
        <span className={"truncate " + (selected ? "" : (disabled ? "text-transparent" : "text-slate-400"))}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className={"shrink-0 " + (disabled && !selected ? "text-transparent" : "text-slate-400")} />
      </button>
      {open && !disabled && pos && createPortal(
        <div ref={menuRef} style={{ position: "fixed", left: pos.left, ...(pos.top ? { top: pos.top } : { bottom: pos.bottom }), width: "max-content", minWidth: pos.width, maxWidth: 350, maxHeight: pos.maxHeight || 288, zIndex: 1000 }}
          className="bg-white border border-slate-200 rounded-lg shadow-lg overflow-auto flex flex-col">
          <div className="p-2 sticky top-0 bg-white border-b border-slate-100">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Gõ để tìm…" size={1}
              className="w-full min-w-[50px] px-2 py-1.5 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          </div>
          <div className="py-1">
            {!filtered.length && <div className="px-3 py-2 text-sm text-slate-400">Không tìm thấy</div>}
            {filtered.map((o) => (
              <button type="button" key={o.value} onClick={() => pick(o.value)}
                className={"w-full text-left truncate px-3 py-1.5 text-xs hover:bg-blue-50 " + (o.value === value ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-700")}
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

export function Pagination({ total, page, size, pageCount, start, onPage, onSize }) {
  if (!total) return null;
  const from = start + 1, to = Math.min(start + size, total);
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span>Hiển thị</span>
        <select value={size} onChange={(e) => onSize(+e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span>dòng · {from}–{to} / {total}</span>
      </div>
      <div className="flex items-center gap-1">
        <button className={pagerBtn} disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
        {pageNumbers(page, pageCount).map((n, i) =>
          n === "…"
            ? <span key={`e${i}`} className="px-1.5 text-slate-400">…</span>
            : <button key={n} onClick={() => onPage(n)}
                className={`${pagerBtn} ${n === page ? "!bg-blue-600 !text-white !border-blue-600" : ""}`}>{n}</button>)}
        <button className={pagerBtn} disabled={page >= pageCount} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

/**
 * Hook phân trang: nhận mảng dữ liệu, trả về `slice` (dòng của trang hiện tại)
 * và `Pager` (component thanh phân trang đã gắn sẵn state). Mặc định 10 dòng/trang.
 */
export function usePager(rows, initialSize = 10) {
  const [size, setSize] = useState(initialSize);
  const [page, setPage] = useState(1);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [pageCount]); // eslint-disable-line
  const start = (page - 1) * size;
  const slice = rows.slice(start, start + size);
  const Pager = () => (
    <Pagination total={total} page={page} size={size} pageCount={pageCount}
      start={start} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} />
  );
  // Hàng trống lấp đầy để bảng luôn cao đúng `size` dòng → thanh phân trang không nhảy.
  const fillCount = total > 0 ? Math.max(0, size - slice.length) : 0;
  const Filler = ({ cols }) => fillCount === 0 ? null : (
    <>{Array.from({ length: fillCount }).map((_, i) => (
      <tr key={`__filler${i}`} aria-hidden="true">
        <td colSpan={cols} className="px-4 py-3">&nbsp;</td>
      </tr>
    ))}</>
  );
  return { slice, Pager, Filler };
}

/* ---- Bảng dữ liệu có bộ lọc theo từng cột ---- */
// Bỏ dấu tiếng Việt để lọc "gần đúng"
const stripAccent = (s) => String(s ?? "").toLowerCase().normalize("NFD")
.replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

const alignCls = (a) => a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";

export function DateInput({ value, onChange, placeholder = "dd/mm/yyyy", className, ...props }) {
  return (
    <input
      type={value ? "date" : "text"}
      onFocus={(e) => (e.target.type = "date")}
      onBlur={(e) => { if (!e.target.value) e.target.type = "text"; }}
      placeholder={placeholder}
      value={value || ""}
      onChange={onChange}
      className={className}
      {...props}
    />
  );
}

/**
 * Bảng dùng chung: có hàng bộ lọc ngay trên hàng tiêu đề cột.
 * columns: [{ key, label, filter?: 'text'|'select'|'date', filterValue?(row), filterKey?,
 *             render?(row), align?, tdClass? }]
 * Lọc nhiều cột cùng lúc (AND), text = gần đúng (bỏ dấu), tự cập nhật danh sách.
 */
export function DataTable({ columns, rows, rowKey, pageSize = 10, emptyText = "Không có dữ liệu", dense = false }) {
  const [filters, setFilters] = useState({});
  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));
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

  const { slice, Pager, Filler } = usePager(filtered, pageSize);
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
                      placeholder={c.label}
                      className={inputCls + " bg-white"}
                      options={[{ value: "__all__", label: "— Tất cả —" }, ...distinct(c).map((v) => ({ value: String(v), label: String(v) }))]}
                    />
                  ) : c.filter === "date" ? (
                    <DateInput value={filters[c.key] || ""} onChange={(e) => setF(c.key, e.target.value)} className={inputCls} />
                  ) : c.filter === "text" ? (
                    <input value={filters[c.key] || ""} onChange={(e) => setF(c.key, e.target.value)} placeholder={c.label} className={inputCls} />
                  ) : null}
                </th>
              ))}
            </tr>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              {columns.map((c) => <th key={c.key} className={`${pad} font-semibold ${alignCls(c.align)}`}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slice.map((r) => (
              <tr key={rowKey(r)} className="hover:bg-slate-50/70">
                {columns.map((c) => (
                  <td key={c.key} className={`${pad} ${alignCls(c.align)} ${c.tdClass || "text-slate-700"}`}>
                    {c.render ? c.render(r) : (r[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={columns.length} className={`${pad} py-10 text-center text-slate-400`}>{emptyText}</td></tr>}
            <Filler cols={columns.length} />
          </tbody>
        </table>
      </div>
      <Pager />
    </div>
  );
}
