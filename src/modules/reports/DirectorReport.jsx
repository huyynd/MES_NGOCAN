import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ShoppingCart, Factory, Users, AlertTriangle, RotateCcw, Wallet, Truck, Clock,
  CalendarDays, Lightbulb, Trophy, PackageCheck, PackageX, ClipboardList, Gauge,
  Lock, CheckCircle2, Receipt, Info, X, ExternalLink, Download, List, ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { reports } from "../../mesApi.js";
import { fmt, fmtDate, toast, statusClass } from "../../ui.js";
import { usePager } from "../../components.jsx";

/* ───────────────────────── Bảng màu & hằng số ───────────────────────── */

/* Nhóm tuổi nợ: khóa dữ liệu · nhãn · màu (tuần tự lạnh → nóng) */
const AGE = [
  { key: "m1", label: "≤ 1 tháng", color: "#38bdf8" },
  { key: "m2", label: "1–2 tháng", color: "#f59e0b" },
  { key: "m3_6", label: "2–6 tháng", color: "#f97316" }, // 61–180 ngày (trên 2 tháng → 6 tháng)
  { key: "gt6", label: "> 6 tháng", color: "#e11d48" },
];

const C = { overdue: "#e11d48", intime: "#0a63b8", good: "#10b981", violet: "#7c3aed", track: "#eef2f6" };

const ACCENTS = {
  blue: { chip: "bg-blue-50 text-blue-600 ring-blue-100", glow: "bg-blue-400/15" },
  emerald: { chip: "bg-emerald-50 text-emerald-600 ring-emerald-100", glow: "bg-emerald-400/15" },
  violet: { chip: "bg-violet-50 text-violet-600 ring-violet-100", glow: "bg-violet-400/15" },
  rose: { chip: "bg-rose-50 text-rose-600 ring-rose-100", glow: "bg-rose-400/15" },
  amber: { chip: "bg-amber-50 text-amber-600 ring-amber-100", glow: "bg-amber-400/15" },
  slate: { chip: "bg-slate-50 text-slate-500 ring-slate-200", glow: "bg-slate-400/10" },
};

const TONES = {
  good: { stripe: "bg-emerald-500", icon: "bg-emerald-50 text-emerald-600", pill: "bg-emerald-50 text-emerald-700", label: "Tốt" },
  warn: { stripe: "bg-amber-400", icon: "bg-amber-50 text-amber-600", pill: "bg-amber-50 text-amber-700", label: "Cần theo dõi" },
  bad: { stripe: "bg-rose-500", icon: "bg-rose-50 text-rose-600", pill: "bg-rose-50 text-rose-700", label: "Nghiêm trọng" },
  neutral: { stripe: "bg-slate-300", icon: "bg-slate-100 text-slate-500", pill: "bg-slate-100 text-slate-600", label: "Thông tin" },
};

const TABS = [
  { k: "sales", label: "Kinh doanh", icon: ShoppingCart },
  { k: "prod", label: "Sản xuất & NVL", icon: Factory },
  { k: "staff", label: "Nhân sự & hiệu suất", icon: Users },
];

// R-17a: thiếu dữ liệu công nợ → tiền để null (hiện "—"), KHÔNG hiện "0 đ" như số thật
const EMPTY_R = {
  overdue_days: 30, total_debt: null, billed_total: null, collected_total: null, customer_count: 0,
  overdue_amount: null, intime_amount: null, overdue_count: 0, buckets: {}, by_customer: [],
};

/* ───────────────────────── Định dạng số ───────────────────────── */

const full = (v) => (v == null ? "—" : fmt(v) + " đ");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

/* Chọn đơn vị theo độ lớn: tỷ / triệu / đ */
function unitOf(v) {
  const a = Math.abs(v || 0);
  if (a >= 1e9) return { d: 1e9, u: "tỷ", dp: 2 };
  if (a >= 1e6) return { d: 1e6, u: "triệu", dp: 1 };
  return { d: 1, u: "đ", dp: 0 };
}
/* Chuỗi tiền rút gọn: "1,25 tỷ" */
function short(v) {
  if (v == null) return "—";
  const { d, u, dp } = unitOf(v);
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: dp }).format(v / d)} ${u}`;
}

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* Đếm số chạy lên mượt (easeOutCubic) */
function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(target ?? 0);
  const cur = useRef(0);
  useEffect(() => {
    if (target == null || !isFinite(target)) return;
    if (reduceMotion()) { cur.current = target; setVal(target); return; }
    const from = cur.current, start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * (1 - Math.pow(1 - t, 3));
      cur.current = v;
      setVal(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

/* Bật cờ sau 1 frame để thanh/biểu đồ chạy từ 0 */
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setM(true)); return () => cancelAnimationFrame(id); }, []);
  return m;
}

/* ───────────────────────── Thành phần cơ bản ───────────────────────── */

function Money({ value, unitClass = "text-[15px] font-medium text-slate-400" }) {
  const { d, u, dp } = unitOf(value);
  const target = value == null ? null : value / d;
  const n = useCountUp(target);
  if (value == null) return <span>—</span>;
  const done = Math.abs(n - target) < 1e-9;
  const s = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: done ? 0 : dp, maximumFractionDigits: dp }).format(n);
  return (
    <span title={full(value)} className="cursor-help">
      {s}<span className={`ml-1.5 ${unitClass}`}>{u}</span>
    </span>
  );
}

function Count({ value }) {
  const n = useCountUp(value ?? 0);
  return <>{fmt(Math.round(n))}</>;
}

/* Thanh ngang nhiều đoạn (có animation) */
function Bar({ segments, height = 6, track = true }) {
  const mounted = useMounted();
  return (
    <div className="flex w-full overflow-hidden rounded-full" style={{ height, background: track ? C.track : "transparent" }}>
      {segments.map((sg, i) => (
        <div key={i} title={sg.title}
          className="h-full transition-[width] duration-1000 ease-out first:rounded-l-full last:rounded-r-full"
          style={{ width: mounted ? `${Math.max(0, Math.min(100, sg.pct))}%` : "0%", background: sg.color, transitionDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}

function Meter({ label, value, color, right }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="font-semibold tabular-nums text-slate-700">{right ?? `${value}%`}</span>
      </div>
      <Bar segments={[{ pct: value, color }]} />
    </div>
  );
}

function KpiCard({ icon: Icon, accent = "blue", label, hint, value, valueClass, meta, footer, delay = 0, onClick, active, compact }) {
  const a = ACCENTS[accent];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white ${compact ? "p-4" : "p-5"} shadow-card transition-all duration-300 animate-rise motion-reduce:animate-none text-left ${active ? "!border-blue-400 ring-2 ring-blue-500/30" : ""} ${onClick ?"cursor-pointer hover:-translate-y-1 hover:shadow-card-hover hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40" : "hover:-translate-y-0.5 hover:shadow-card-hover"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full blur-2xl transition-opacity duration-300 group-hover:opacity-100 opacity-70 ${a.glow}`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-600">{label}</div>
          {hint && <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">{hint}</div>}
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${a.chip}`}>
          <Icon size={18} strokeWidth={2} />
        </div>
      </div>
      <div className={`relative ${compact ? "mt-3" : "mt-4"} font-display font-semibold leading-none tracking-tight text-slate-900 tabular-nums ${valueClass || (compact ? "text-[26px]" : "text-[30px]")}`}>
        {value}
      </div>
      {meta && <div className={`relative mt-2 ${compact ? "text-xs" : "text-[13px]"} text-slate-500`}>{meta}</div>}
      {footer && <div className={`relative mt-auto ${compact ? "pt-3" : "pt-4"}`}><div className={`border-t border-slate-100 ${compact ? "pt-3" : "pt-3.5"}`}>{footer}</div></div>}
    </Comp>
  );
}

function Panel({ title, subtitle, icon: Icon, action, children, className = "", delay = 0 }) {
  return (
    <section
      className={`rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card animate-rise motion-reduce:animate-none ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {Icon && (
            <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Icon size={15} />
            </div>
          )}
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Empty({ icon: Icon = CheckCircle2, text, tone = "text-emerald-500" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center">
      <Icon size={22} className={tone} />
      <div className="text-sm text-slate-500">{text}</div>
    </div>
  );
}

/* Donut SVG thuần — tâm chính xác, không phụ thuộc Legend */
function Donut({ segments, size = 172, stroke = 16, children }) {
  const mounted = useMounted();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
  const visible = segments.filter((s) => s.value > 0).length;
  const gap = visible > 1 ? 6 : 0;
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.track} strokeWidth={stroke} />
        {total > 0 && segments.map((s, i) => {
          const len = (s.value / total) * circ;
          const dash = Math.max(0, len - gap);
          const off = -acc;
          acc += len;
          if (s.value <= 0) return null;
          return (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeLinecap={visible > 1 ? "butt" : "round"}
              strokeDasharray={`${mounted ? dash : 0} ${circ}`} strokeDashoffset={off}
              style={{ transition: `stroke-dasharray 1.1s cubic-bezier(.2,.7,.2,1) ${i * 120}ms` }}>
              <title>{`${s.label}: ${full(s.value)}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

function Skeleton() {
  const blk = "rounded-md bg-slate-200/70";
  return (
    <div className="animate-pulse space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-slate-200/70 bg-white p-5">
            <div className={`${blk} h-3 w-24`} />
            <div className={`${blk} mt-5 h-7 w-32`} />
            <div className={`${blk} mt-3 h-3 w-20`} />
            <div className={`${blk} mt-6 h-1.5 w-full`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="h-80 rounded-2xl border border-slate-200/70 bg-white lg:col-span-7" />
        <div className="h-80 rounded-2xl border border-slate-200/70 bg-white lg:col-span-5" />
      </div>
    </div>
  );
}

/* ───────────────────────── Tab 1 · Kinh doanh ───────────────────────── */

function SalesView({ s, r, period }) {
  const navigate = useNavigate();
  const periodLb = period === "week" ? "Tuần này" : "Tháng này";
  const total = r.total_debt;
  const ovPct = pct(r.overdue_amount, total);
  const collectRate = pct(r.collected_total, r.billed_total);
  const shipRate = pct(s.shipped_count, s.order_count);
  const deliveredPct = pct(s.delivered_value, s.total_value);
  const buckets = AGE.map((a) => ({ ...a, value: r.buckets?.[a.key] || 0 }));

  const top5 = r.by_customer.slice(0, 5);
  const top5Sum = top5.reduce((a, c) => a + c.debt, 0);
  const otherDebt = Math.max(0, total - top5Sum);
  const otherCount = Math.max(0, (r.customer_count || 0) - top5.length);
  const maxDebt = Math.max(1, ...top5.map((c) => c.debt));
  const otherRow = otherDebt > 1e-6
    ? { name: "Phần khác", other: true, debt: otherDebt, ...Object.fromEntries(buckets.map((b) => [b.key, Math.max(0, b.value - top5.reduce((a, c) => a + (c[b.key] || 0), 0))])) }
    : null;
  const tableRows = otherRow ? [...top5, otherRow] : top5;
  // Top khách nợ xấu: xếp theo tiền QUÁ HẠN (nhiều nhất = top 1)
  const badTop = (r.bad_customers || []).slice(0, 5);
  const badTotal = r.bad_total || 0;
  const badOther = Math.max(0, badTotal - badTop.reduce((a, c) => a + c.overdue, 0));
  const badOtherCount = Math.max(0, (r.bad_count || 0) - badTop.length);
  const maxBad = Math.max(1, ...badTop.map((c) => c.overdue));
  const maxCell = Math.max(1, ...tableRows.flatMap((c) => AGE.map((a) => c[a.key] || 0)));

  const [ordersModal, setOrdersModal] = useState(false);
  const [deliveriesModal, setDeliveriesModal] = useState(false);

  /* Điểm nhấn tự động cho lãnh đạo */
  const insights = [];
  if (total > 0) {
    insights.push({
      tone: ovPct >= 30 ? "bad" : ovPct >= 10 ? "warn" : "good", icon: AlertTriangle,
      title: `${ovPct}% dư nợ đã quá hạn`,
      text: `${short(r.overdue_amount)} · ${fmt(r.overdue_count)} phiếu giao quá ${r.overdue_days} ngày`,
    });
  }
  if (top5[0] && total > 0) {
    const sh = pct(top5[0].debt, total);
    insights.push({
      tone: sh >= 40 ? "bad" : sh >= 25 ? "warn" : "neutral", icon: Users,
      title: `${top5[0].name} chiếm ${sh}% dư nợ`,
      text: sh >= 25 ? "Mức tập trung cao — nên ưu tiên đôn đốc thu hồi" : "Rủi ro tập trung ở mức an toàn",
    });
  }
  if ((r.buckets?.gt6 || 0) > 0) {
    insights.push({
      tone: "bad", icon: Clock,
      title: `${short(r.buckets.gt6)} nợ trên 6 tháng`,
      text: "Nguy cơ nợ khó đòi — cân nhắc trích lập dự phòng",
    });
  }
  if (r.billed_total > 0) {
    insights.push({
      tone: collectRate >= 85 ? "good" : collectRate >= 60 ? "warn" : "bad", icon: Wallet,
      title: `Thu hồi lũy kế đạt ${collectRate}%`,
      text: `${short(r.collected_total)} trên ${short(r.billed_total)} đã giao hàng`,
    });
  }
  if ((r.bad_count || 0) > 0) {
    insights.push({
      tone: "bad", icon: AlertTriangle,
      title: `${fmt(r.bad_count)} khách nợ xấu`,
      text: `${short(r.bad_total)} quá hạn trên ${r.overdue_days} ngày — cần đôn đốc / cân nhắc dừng giao`,
    });
  }
  // Kinh doanh trong kỳ
  if (s.order_count > 0) {
    insights.push({
      tone: shipRate >= 70 ? "good" : shipRate >= 40 ? "warn" : "bad", icon: Truck,
      title: `${shipRate}% đơn ${periodLb.toLowerCase()} đã xuất giao`,
      text: `${fmt(s.shipped_count)}/${fmt(s.order_count)} đơn · ${fmt(s.fully_count)} đơn đã giao đủ`,
    });
  }
  if ((s.undelivered_value || 0) > 0) {
    insights.push({
      tone: deliveredPct < 50 ? "warn" : "neutral", icon: ShoppingCart,
      title: `${short(s.undelivered_value)} giá trị đơn chưa giao`,
      text: `${100 - deliveredPct}% giá trị đơn hàng ${periodLb.toLowerCase()} — theo dõi tiến độ sản xuất & giao`,
    });
  }
  // Bản tin: nghiêm trọng trước, tốt sau cùng
  const RANK = { bad: 0, warn: 1, neutral: 2, good: 3 };
  insights.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  const [showAllNews, setShowAllNews] = useState(false);
  const NEWS_MAX = 4;
  const news = showAllNews ? insights : insights.slice(0, NEWS_MAX);

  return (
    <div className="space-y-5">
      {/* KPI 2×2 (3/4 màn) · Bản tin điểm nhấn (1/4 màn) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-3">
        <KpiCard compact
          icon={ShoppingCart} accent="blue" label="Giá trị đơn hàng" hint={periodLb} delay={0}
          onClick={() => setOrdersModal(true)}
          value={<Money value={s.total_value} />}
          meta={<><span className="font-semibold text-slate-700"><Count value={s.order_count} /></span> đơn hàng mới</>}
          footer={
            <div>
              <Bar segments={[
                { pct: deliveredPct, color: C.intime, title: `Đã giao: ${full(s.delivered_value)}` },
                { pct: 100 - deliveredPct, color: "#bfd3ea", title: `Chưa giao: ${full(s.undelivered_value)}` },
              ]} />
              <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">Đã giao <b className="font-semibold text-slate-700">{short(s.delivered_value)}</b></span>
                <span className="text-slate-500">Chưa giao <b className="font-semibold text-slate-700">{short(s.undelivered_value)}</b></span>
              </div>
            </div>
          }
        />
        <KpiCard compact
          icon={Truck} accent="emerald" label="Tiến độ giao hàng" hint={periodLb} delay={70}
          // Mở danh sách Phiếu giao hàng / Hóa đơn trong kỳ (trước đây lối vào nằm ở ô "Tiền đã thu";
          // ô đó nay mở Báo cáo công nợ). Danh sách đơn hàng vẫn mở từ ô "Giá trị đơn hàng".
          onClick={() => setDeliveriesModal(true)}
          value={<><Count value={s.shipped_count} /><span className="ml-1.5 text-[15px] font-medium text-slate-400">/ {fmt(s.order_count)} đơn</span></>}
          meta={<><span className="font-semibold text-slate-700">{fmt(s.fully_count)}</span> đơn đã giao đủ</>}
          footer={<Meter label="Tỷ lệ đơn đã xuất giao" value={shipRate} color={C.good} />}
        />
        <KpiCard compact
          icon={Receipt} accent="violet" label="Tiền đã thu" hint="Lũy kế đến hôm nay" delay={140}
          // Số lũy kế → mở Báo cáo công nợ (đã trả / còn nợ theo từng khách), không phải danh sách phiếu giao trong kỳ
          onClick={() => navigate("/receivables")}
          value={<Money value={r.collected_total} />}
          meta={<>trên <span className="font-semibold text-slate-700" title={`${full(r.billed_total)} — tổng tiền các phiếu đã giao hàng`}>{short(r.billed_total)}</span> đã giao hàng
            {r.credit_total > 0 && <> · gồm <span className="font-semibold text-blue-700" title={full(r.credit_total)}>{short(r.credit_total)}</span> trả trước</>}</>}
          footer={<Meter label="Tỷ lệ thu hồi" value={collectRate} color={C.violet} />}
        />
        <KpiCard compact
          icon={Wallet} accent="rose" label="Dư nợ phải thu" hint="Tại thời điểm hiện tại" delay={210}
          onClick={() => document.getElementById('debt-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          value={<Money value={total} />}
          meta={<>từ <span className="font-semibold text-slate-700">{fmt(r.customer_count)}</span> khách hàng</>}
          footer={
            <div>
              <Bar segments={[
                { pct: ovPct, color: C.overdue, title: `Quá hạn: ${full(r.overdue_amount)}` },
                { pct: total > 0 ? 100 - ovPct : 0, color: C.intime, title: `Trong hạn: ${full(r.intime_amount)}` },
              ]} />
              <div className="mt-2 flex flex-wrap justify-between gap-x-2 gap-y-1 text-[11.5px]">
                <span className="text-slate-500">Quá hạn <b className="font-semibold text-rose-600">{short(r.overdue_amount)}</b></span>
                <span className="text-slate-500">Trong hạn <b className="font-semibold text-slate-700">{short(r.intime_amount)}</b></span>
              </div>
            </div>
          }
        />
      </div>

      {/* Bản tin điểm nhấn — cao bằng khối 4 ô bên trái, dài thì cuộn trong khung */}
      <div className="lg:relative">
        <section className="flex flex-col rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card animate-rise motion-reduce:animate-none lg:absolute lg:inset-0"
          style={{ animationDelay: "260ms" }}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Lightbulb size={15} /></div>
              <h3 className="text-[15px] font-semibold text-slate-900">Điểm nhấn</h3>
            </div>
            {insights.length > 0 && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white">{insights.length}</span>}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Tự động rút ra từ số liệu kinh doanh & công nợ</p>
          <div className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
            {news.length ? news.map((it, i) => {
              const t = TONES[it.tone];
              return (
                <div key={i} className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 pl-4">
                  <span className={`absolute inset-y-0 left-0 w-1 ${t.stripe}`} />
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${t.pill}`}>{t.label}</span>
                  <div className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-900">{it.title}</div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{it.text}</div>
                </div>
              );
            }) : <Empty text="Chưa có điểm nhấn nào." />}
          </div>
          {insights.length > NEWS_MAX && (
            <button type="button" onClick={() => setShowAllNews((v) => !v)}
              className="mt-3 inline-flex items-center justify-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
              {showAllNews ? "Thu gọn" : `Xem tất cả (${insights.length})`} <ChevronRight size={13} className={showAllNews ? "-rotate-90" : ""} />
            </button>
          )}
        </section>
      </div>
      </div>

      {/* Top khách hàng · Cơ cấu nợ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7" delay={320} icon={Users}
          title="Top khách hàng theo dư nợ"
          subtitle="Độ dài thanh theo dư nợ · màu theo tuổi nợ"
        >
          {top5.length ? (
            <>
              <div className="-mt-1 mb-3 border-b border-slate-100 pb-3"><Legend items={AGE} /></div>
              <ol className="divide-y divide-slate-100">
                {top5.map((c, i) => {
                  const share = pct(c.debt, total);
                  return (
                    <li key={c.name} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3 first:pt-0">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${i === 0 ? "bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100" : "bg-slate-100 text-slate-500"}`}>{i + 1}</span>
                      <span className="truncate text-sm font-medium text-slate-800" title={c.name}>{c.name}</span>
                      <span className="text-right text-sm tabular-nums">
                        <b className="font-semibold text-slate-900" title={full(c.debt)}>{short(c.debt)}</b>
                        <span className="ml-2 inline-block w-10 text-right text-xs font-medium text-slate-400">{share}%</span>
                      </span>
                      <div className="col-span-2 col-start-2">
                        <div style={{ width: `${(c.debt / maxDebt) * 100}%` }}>
                          <Bar height={8} track={false} segments={AGE.map((a) => ({
                            pct: c.debt > 0 ? ((c[a.key] || 0) / c.debt) * 100 : 0, color: a.color,
                            title: `${a.label}: ${full(c[a.key] || 0)}`,
                          }))} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {otherRow && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  <span>+ {fmt(otherCount)} khách hàng khác</span>
                  <span className="tabular-nums"><b className="font-semibold text-slate-700">{short(otherDebt)}</b><span className="ml-2 inline-block w-10 text-right">{pct(otherDebt, total)}%</span></span>
                </div>
              )}
            </>
          ) : <Empty text="Không có công nợ phải thu." />}
        </Panel>

        <Panel className="lg:col-span-5" delay={380} icon={AlertTriangle}
          title="Cơ cấu dư nợ" subtitle={`Quá hạn khi giao hàng quá ${r.overdue_days} ngày chưa thanh toán`}>
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
            <Donut segments={[
              { label: "Quá hạn", value: r.overdue_amount, color: C.overdue },
              { label: "Trong hạn", value: r.intime_amount, color: C.intime },
            ]}>
              <div className="font-display text-[34px] font-semibold leading-none tracking-tight text-slate-900">{ovPct}<span className="text-xl text-slate-400">%</span></div>
              <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-rose-500">Quá hạn</div>
            </Donut>
            <div className="w-full flex-1 space-y-3">
              {[["Quá hạn", r.overdue_amount, C.overdue, `${fmt(r.overdue_count)} phiếu giao`], ["Trong hạn", r.intime_amount, C.intime, `≤ ${r.overdue_days} ngày`]].map(([lb, v, col, sub]) => (
                <div key={lb} className="rounded-xl border border-slate-100 px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><span className="h-2 w-2 rounded-full" style={{ background: col }} />{lb}</div>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-base font-semibold tabular-nums text-slate-900" title={full(v)}>{short(v)}</span>
                    <span className="text-[11px] text-slate-400">{sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.06em] text-slate-400">Theo tuổi nợ</div>
            <ul className="space-y-3">
              {buckets.map((b) => {
                const p = pct(b.value, total);
                return (
                  <li key={b.key} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-600"><span className="h-2 w-2 rounded-sm" style={{ background: b.color }} />{b.label}</span>
                    <Bar height={6} segments={[{ pct: p, color: b.color, title: `${b.label}: ${full(b.value)}` }]} />
                    <span className="whitespace-nowrap text-right tabular-nums">
                      <b className="font-semibold text-slate-800" title={full(b.value)}>{short(b.value)}</b>
                      <span className="ml-1.5 inline-block w-8 text-slate-400">{p}%</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>
      </div>

      {/* Top khách NỢ XẤU: xếp theo tiền quá hạn (nhiều nhất = top 1) — thanh 1 màu, không chia tuổi nợ */}
      <Panel delay={420} icon={AlertTriangle}
        title="Top khách nợ xấu"
        subtitle={`Xếp theo tiền nợ quá ${r.overdue_days} ngày · ${fmt(r.bad_count || 0)} khách nợ xấu · tổng ${short(badTotal)}`}
        action={<button type="button" onClick={() => navigate("/receivables")} className="text-xs font-medium text-blue-600 hover:underline">Xem báo cáo công nợ →</button>}>
        {badTop.length ? (
          <>
            <ol className="divide-y divide-slate-100">
              {badTop.map((c, i) => (
                <li key={c.customer_id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3 first:pt-0">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${i < 3 ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-500"}`}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800" title={c.name}>{c.name}</span>
                    <span className="block text-xs text-slate-400">
                      Nợ lâu nhất <b className="font-semibold text-rose-600">{fmt(c.oldest_days)} ngày</b> · tổng nợ {short(c.debt)}
                      {c.over_limit && <span className="ml-1.5 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">Vượt hạn mức</span>}
                    </span>
                  </span>
                  <span className="text-right text-sm tabular-nums">
                    <b className="font-semibold text-rose-600" title={full(c.overdue)}>{short(c.overdue)}</b>
                    <span className="ml-2 inline-block w-10 text-right text-xs font-medium text-slate-400">{pct(c.overdue, badTotal)}%</span>
                  </span>
                  <div className="col-span-2 col-start-2">
                    <div style={{ width: `${(c.overdue / maxBad) * 100}%` }}>
                      <Bar height={8} track={false} segments={[{ pct: 100, color: C.overdue, title: `Quá hạn: ${full(c.overdue)}` }]} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {badOther > 1e-6 && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <span>+ {fmt(badOtherCount)} khách nợ xấu khác</span>
                <span className="tabular-nums"><b className="font-semibold text-slate-700">{short(badOther)}</b><span className="ml-2 inline-block w-10 text-right">{pct(badOther, badTotal)}%</span></span>
              </div>
            )}
          </>
        ) : <Empty text={`Không có khách nợ quá ${r.overdue_days} ngày.`} />}
      </Panel>

      {/* Bảng chi tiết */}
      <div id="debt-table">
        <Panel delay={440} icon={Receipt} title="Chi tiết công nợ theo khách hàng"
          subtitle="Màu nền ô đậm dần theo giá trị — giúp nhận ra điểm nóng nhanh"
          action={<span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">Đơn vị: VNĐ</span>}>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-y border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">
                <th className="w-12 py-2.5 pl-5 text-left">#</th>
                <th className="py-2.5 pr-3 text-left">Khách hàng</th>
                <th className="px-3 py-2.5 text-right">Dư nợ</th>
                <th className="w-28 px-3 py-2.5 text-left">Tỷ trọng</th>
                {AGE.map((a) => (
                  <th key={a.key} className="px-3 py-2.5 text-right last:pr-5">
                    <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: a.color }} />{a.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tableRows.length ? tableRows.map((c, i) => {
                const share = pct(c.debt, total);
                return (
                  <tr key={c.name} className={`transition-colors hover:bg-slate-50/80 ${c.other ? "text-slate-500" : ""}`}>
                    <td className="py-2.5 pl-5 text-xs font-medium tabular-nums text-slate-400">{c.other ? "" : i + 1}</td>
                    <td className={`max-w-[240px] truncate py-2.5 pr-3 ${c.other ? "italic" : "font-medium text-slate-800"}`} title={c.name}>
                      {c.other ? `Phần khác (${fmt(otherCount)} khách)` : c.name}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{fmt(c.debt)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-400" style={{ width: `${share}%` }} /></div>
                        <span className="w-8 text-right text-xs tabular-nums text-slate-500">{share}%</span>
                      </div>
                    </td>
                    {AGE.map((a) => {
                      const v = c[a.key] || 0;
                      const alpha = v > 0 ? Math.round((0.06 + 0.24 * (v / maxCell)) * 255).toString(16).padStart(2, "0") : "00";
                      return (
                        <td key={a.key} className="px-1.5 py-1.5 text-right last:pr-4">
                          <span className={`block rounded-md px-1.5 py-1 tabular-nums ${v ? "text-slate-700" : "text-slate-300"}`} style={{ background: `${a.color}${alpha}` }}>
                            {v ? fmt(v) : "—"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              }) : (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-400">Không có công nợ.</td></tr>
              )}
            </tbody>
            {tableRows.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/70 font-semibold text-slate-900">
                  <td className="py-3 pl-5" />
                  <td className="py-3 pr-3 text-xs uppercase tracking-[0.05em]">Tổng cộng</td>
                  <td className="px-3 py-3 text-right tabular-nums text-rose-600">{fmt(total)}</td>
                  <td className="px-3 py-3 text-xs text-slate-500">100%</td>
                  {buckets.map((b) => <td key={b.key} className="px-3 py-3 text-right tabular-nums last:pr-5">{fmt(b.value)}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Panel>
      </div>

      {/* Modal: Danh sách đơn hàng */}
      {ordersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-rise">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="font-display text-lg font-semibold text-slate-800">
                Chi tiết {s.order_count} đơn hàng {period === "week" ? "tuần này" : "tháng này"}
              </h3>
              <button onClick={() => setOrdersModal(false)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-6">
              {s.orders?.length ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Ngày</th>
                        <th className="px-4 py-3 text-left">Mã đơn</th>
                        <th className="px-4 py-3 text-left">Khách hàng</th>
                        <th className="px-4 py-3 text-right">Tổng tiền</th>
                        <th className="px-4 py-3 text-right">Đã giao</th>
                        <th className="px-4 py-3 text-right">Chưa giao</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {s.orders.map((o) => (
                        <tr key={o.id} className="transition hover:bg-slate-50/50">
                          <td className="px-4 py-3 text-slate-500 tabular-nums">{fmtDate(o.date)}</td>
                          <td className="px-4 py-3 font-medium text-blue-600">{o.order_code}</td>
                          <td className="px-4 py-3 text-slate-700">{o.customer || "—"}</td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">{fmt(o.total)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{o.delivered > 0 ? fmt(o.delivered) : "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-500">{o.undelivered > 0 ? fmt(o.undelivered) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50/70 font-semibold text-slate-800">
                        <td colSpan={3} className="px-4 py-3 text-right">TỔNG CỘNG</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-900">{fmt(s.total_value)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{fmt(s.delivered_value)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{fmt(s.undelivered_value)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="py-8 text-center text-slate-500">Không có đơn hàng nào trong kỳ.</div>
              )}
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Bạn có thể cập nhật thông tin tại menu <b>Kinh doanh &gt; Đơn hàng</b>
              </span>
              <button onClick={() => setOrdersModal(false)} className="rounded-lg bg-slate-800 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-700">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Danh sách phiếu giao / hóa đơn */}
      {deliveriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-rise">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="font-display text-lg font-semibold text-slate-800">
                Chi tiết Phiếu giao hàng / Hóa đơn {period === "week" ? "tuần này" : "tháng này"}
              </h3>
              <button onClick={() => setDeliveriesModal(false)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-6">
              {s.deliveries?.length ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Ngày</th>
                        <th className="px-4 py-3 text-left">Mã phiếu</th>
                        <th className="px-4 py-3 text-left">Khách hàng</th>
                        <th className="px-4 py-3 text-right">Tổng tiền (Hóa đơn)</th>
                        <th className="px-4 py-3 text-right">Đã thu</th>
                        <th className="px-4 py-3 text-right">Còn nợ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {s.deliveries.map((d) => (
                        <tr key={d.id} className="transition hover:bg-slate-50/50">
                          <td className="px-4 py-3 text-slate-500 tabular-nums">{fmtDate(d.date)}</td>
                          <td className="px-4 py-3 font-medium text-violet-600">{d.code}</td>
                          <td className="px-4 py-3 text-slate-700">{d.customer || "—"}</td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">{fmt(d.total)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{d.paid > 0 ? fmt(d.paid) : "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-rose-500">{(d.total - d.paid) > 0 ? fmt(d.total - d.paid) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-8 text-center text-slate-500">Không có phiếu giao hàng nào trong kỳ.</div>
              )}
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Cập nhật thông tin tại menu <b>Kinh doanh &gt; Phiếu giao hàng</b>
              </span>
              <button onClick={() => setDeliveriesModal(false)} className="rounded-lg bg-slate-800 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-700">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Tab 2 · Sản xuất ───────────────────────── */

/* Trạng thái LSX: khóa dữ liệu · nhãn · màu */
const PO_STATES = [
  { key: "done", label: "Hoàn thành", color: C.good },
  { key: "running", label: "Đang sản xuất", color: C.intime },
  { key: "not_started", label: "Chưa bắt đầu", color: "#94a3b8" },
  { key: "wait_nvl", label: "Chờ NVL", color: "#f59e0b" },
];

const Kg = ({ value }) => <><Count value={value} /><span className="ml-1.5 text-[15px] font-medium text-slate-400">kg</span></>;

/* Bảng chi tiết cuối tab "Sản xuất & NVL": mỗi thẻ / ô trạng thái = 1 góc nhìn */
const PROD_VIEWS = {
  all: { label: "Tất cả lệnh sản xuất", test: () => true },
  total: { label: "Lệnh sản xuất (không tính lệnh hủy)", test: (r) => r.status !== "Đã hủy" },
  plan: { label: "Sản lượng kế hoạch — lệnh tính bằng kg", test: (r) => r.is_kg && r.status !== "Đã hủy" },
  actual: { label: "SL thành phẩm (thực tế) — lệnh đã có sản lượng", test: (r) => r.is_kg && r.status !== "Đã hủy" && r.actual > 0 },
  remain: { label: "Sản lượng còn lại — lệnh còn phải sản xuất", test: (r) => r.is_kg && r.status !== "Đã hủy" && r.remaining > 0 },
  done: { label: "Lệnh hoàn thành", test: (r) => r.status === "Hoàn thành" },
  running: { label: "Lệnh đang sản xuất", test: (r) => r.status === "Đang sản xuất" },
  not_started: { label: "Lệnh chưa bắt đầu", test: (r) => r.status === "Chờ duyệt" || r.status === "Đã lên kế hoạch" },
  wait_nvl: { label: "Lệnh chờ nguyên vật liệu", test: (r) => r.status === "Chờ nguyên vật liệu" },
  overdue: { label: "Lệnh quá hạn", test: (r) => !!r.overdue },
  scrap: { label: "Phế phẩm theo ngày (Quản lý phế)" },
};

const th = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const td = "px-4 py-2.5 text-sm text-slate-700";

function ProdDetail({ view, rows, isScrap, periodLb }) {
  const { slice, Pager, Filler } = usePager(rows, 5, [5, 10, 20]);
  const label = PROD_VIEWS[view].label;
  const exportExcel = () => {
    if (!rows.length) { toast.error("Danh sách đang trống, không có gì để xuất"); return; }
    const data = isScrap
      ? rows.map((d) => ({ "Ngày": fmtDate(d.date), "SL thành phẩm (kg)": d.finished, "SL phế (kg)": d.scrap,
          "Tỷ lệ phế (%)": d.finished > 0 ? Math.round(d.scrap / (d.finished + d.scrap) * 1000) / 10 : "" }))
      : rows.map((r) => ({ "Mã lệnh SX": r.code, "Mã SP": r.product_code, "Tên sản phẩm": r.product_name,
          "Ngày tạo": fmtDate(r.created), "Hạn chót": fmtDate(r.due) || "", "Quá hạn": r.overdue ? "Có" : "",
          "SL kế hoạch": r.plan, "SL thực tế": r.actual, "SL còn lại": r.remaining, "Đơn vị": r.unit || "", "Trạng thái": r.status }));
    const ws = XLSX.utils.aoa_to_sheet([[`${label} · ${periodLb}`], []]);
    XLSX.utils.sheet_add_json(ws, data, { origin: "A3" });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isScrap ? "Phế phẩm" : "Lệnh sản xuất");
    XLSX.writeFile(wb, `bao-cao-giam-doc_${view}.xlsx`);
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-100">
          {label} · {fmt(rows.length)} dòng
        </span>
        <button type="button" onClick={exportExcel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
          <Download size={14} /> Xuất Excel
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full whitespace-nowrap">
          <thead className="bg-slate-50">
            {isScrap ? (
              <tr><th className={th}>Ngày</th><th className={`${th} text-right`}>SL thành phẩm</th><th className={`${th} text-right`}>SL phế</th><th className={`${th} text-right`}>Tỷ lệ phế</th></tr>
            ) : (
              <tr><th className={th}>Mã lệnh</th><th className={th}>Sản phẩm</th><th className={th}>Ngày tạo</th><th className={th}>Hạn chót</th>
                <th className={`${th} text-right`}>Kế hoạch</th><th className={`${th} text-right`}>Thực tế</th><th className={`${th} text-right`}>Còn lại</th><th className={th}>Trạng thái</th></tr>
            )}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!rows.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">Không có dữ liệu</td></tr>}
            {isScrap ? slice.map((d) => (
              <tr key={d.date} className="hover:bg-slate-50/70">
                <td className={td}>{fmtDate(d.date)}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(d.finished)} kg</td>
                <td className={`${td} text-right font-semibold tabular-nums text-rose-600`}>{fmt(d.scrap)} kg</td>
                <td className={`${td} text-right tabular-nums`}>{d.finished > 0 ? `${(d.scrap / (d.finished + d.scrap) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            )) : slice.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/70">
                <td className={`${td} font-medium text-slate-900`}>{r.code}</td>
                <td className={`${td} max-w-[260px] truncate`} title={`${r.product_code} · ${r.product_name}`}>{r.product_name}</td>
                <td className={td}>{fmtDate(r.created)}</td>
                <td className={`${td} ${r.overdue ? "font-semibold text-rose-600" : ""}`}>{fmtDate(r.due) || "—"}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(r.plan)} <span className="text-xs text-slate-400">{r.unit}</span></td>
                <td className={`${td} text-right tabular-nums`}>{fmt(r.actual)}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(r.remaining)}</td>
                <td className={td}><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span></td>
              </tr>
            ))}
            {rows.length > 0 && <Filler cols={isScrap ? 4 : 8} />}
          </tbody>
        </table>
      </div>
      <div className="mt-3"><Pager /></div>
    </>
  );
}

function ProdView({ p, period }) {
  const navigate = useNavigate();
  const periodLb = period === "week" ? "LSX tạo tuần này" : "LSX tạo tháng này";
  const o = p.output || {}, ord = p.orders || {}, shortages = p.shortages || [], low = p.low_stock || [];
  const achieve = pct(o.actual, o.plan);
  const [view, setView] = useState("all");
  const listRef = useRef(null);
  // Bấm thẻ → đổi góc nhìn bảng chi tiết cuối tab + cuộn xuống (bấm lại thẻ đang chọn → về "Tất cả")
  const pick = (key) => {
    setView((v) => (v === key ? "all" : key));
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const isScrap = view === "scrap";
  const detailRows = isScrap ? (p.scrap_days || []) : (p.order_list || []).filter(PROD_VIEWS[view].test);
  const goOutput = (key) => () => pick(key);
  // Mức nghiêm trọng tồn thấp: tồn / tối thiểu
  const lowColor = (m) => { const r = m.min_qty > 0 ? m.on_hand / m.min_qty : 0; return r < 0.25 ? C.overdue : r < 0.5 ? "#f97316" : "#f59e0b"; };
  return (
    <div className="space-y-5">
      {/* Hàng 1 · Sản lượng (kg) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={ClipboardList} accent="blue" label="Sản lượng kế hoạch" hint={periodLb} onClick={goOutput("plan")} active={view === "plan"}
          value={<Kg value={o.plan} />}
          meta={o.non_kg_count > 0 ? <span title="Chưa quy đổi đơn vị — các lệnh không tính bằng kg chưa được cộng vào">Chưa tính {fmt(o.non_kg_count)} lệnh khác đơn vị kg</span> : "Tổng các lệnh tính bằng kg"} />
        <KpiCard icon={Factory} accent="emerald" label="SL thành phẩm (thực tế)" hint="Công đoạn cuối của lệnh tạo trong kỳ" delay={70} onClick={goOutput("actual")} active={view === "actual"}
          value={<Kg value={o.actual} />}
          footer={<Meter label="Đạt kế hoạch" value={Math.min(100, achieve)} right={`${achieve}%`} color={C.good} />} />
        <KpiCard icon={Clock} accent="amber" label="Sản lượng còn lại" hint="Còn phải sản xuất" delay={140} onClick={goOutput("remain")} active={view === "remain"}
          value={<Kg value={o.remaining} />}
          meta={o.over > 0 ? <>Vượt kế hoạch <span className="font-semibold text-slate-700">{fmt(o.over)}</span> kg</> : "Kế hoạch − thực tế"} />
        <KpiCard icon={PackageX} accent={o.scrap > 0 ? "rose" : "slate"} label="Phế phẩm" hint="Theo Quản lý phế" delay={210} onClick={goOutput("scrap")} active={view === "scrap"}
          value={<Kg value={o.scrap} />}
          meta={<>Tỷ lệ phế <span className="font-semibold text-slate-700">{o.scrap_rate == null ? "—" : `${o.scrap_rate}%`}</span></>} />
      </div>

      {/* Hàng 2 · Lệnh sản xuất */}
      <Panel delay={260} icon={ClipboardList} title="Lệnh sản xuất" subtitle={`${periodLb}${ord.cancelled ? ` · không tính ${fmt(ord.cancelled)} lệnh đã hủy` : ""}`}
        action={ord.overdue > 0 && (
          <button type="button" onClick={() => pick("overdue")}
            className={`inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 ring-inset transition hover:bg-rose-100 ${view === "overdue" ? "ring-2 ring-rose-400" : "ring-1 ring-rose-100"}`}>
            <AlertTriangle size={13} /> {fmt(ord.overdue)} lệnh quá hạn
          </button>
        )}>
        {ord.total ? (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[{ key: "total", label: "Tổng LSX" }, ...PO_STATES].map((st) => (
                <button key={st.key} type="button" onClick={() => pick(st.key)}
                  className={`rounded-xl px-4 py-3 text-left transition hover:bg-slate-100 ${view === st.key ? "bg-blue-50 ring-2 ring-blue-400" : "bg-slate-50"}`}>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    {st.color && <span className="h-2 w-2 rounded-full" style={{ background: st.color }} />}{st.label}
                  </div>
                  <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900"><Count value={ord[st.key]} /></div>
                </button>
              ))}
            </div>
            <Bar height={10} segments={PO_STATES.map((st) => ({ pct: pct(ord[st.key], ord.total), color: st.color, title: `${st.label}: ${ord[st.key]}` }))} />
          </>
        ) : <Empty icon={Info} tone="text-slate-400" text="Chưa có lệnh sản xuất nào tạo trong kỳ." />}
      </Panel>

      {/* Hàng 3 · NVL */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel delay={320} icon={PackageX} title="NVL đang thiếu"
          subtitle="Cộng dồn NVL cần cung cấp của mọi lệnh đang mở chưa xuất NVL, so với tồn kho NVL">
          {shortages.length ? (
            <ul className="divide-y divide-slate-100">
              {shortages.map((m) => (
                <li key={m.code} className="py-2.5 first:pt-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-slate-800" title={`${m.code} · ${m.name}`}>{m.name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-600">−{fmt(m.short)} <span className="text-xs font-medium text-slate-400">{m.unit}</span></span>
                  </div>
                  <div className="mt-1.5">
                    <Bar height={6} segments={[{ pct: pct(m.on_hand, m.need), color: C.good, title: `Tồn ${fmt(m.on_hand)}` }, { pct: 100 - pct(m.on_hand, m.need), color: C.overdue, title: `Thiếu ${fmt(m.short)}` }]} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Cần {fmt(m.need)} · tồn {fmt(m.on_hand)} {m.unit} · ảnh hưởng <span className="font-semibold text-slate-700">{fmt(m.po_count)}</span> lệnh
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty text="Đủ NVL cho mọi lệnh đang mở." />}
        </Panel>

        <Panel delay={380} icon={AlertTriangle} title="Cảnh báo tồn kho"
          subtitle="Dưới mức tồn tối thiểu khai ở Master data sản phẩm (Định mức theo Kho)"
          action={<Legend items={[{ label: "< 25%", color: C.overdue }, { label: "< 50%", color: "#f97316" }, { label: "< 100%", color: "#f59e0b" }]} />}>
          {low.length ? (
            <ul className="divide-y divide-slate-100">
              {low.map((m) => (
                <li key={`${m.code}-${m.warehouse}`} className="py-2.5 first:pt-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-slate-800" title={`${m.code} · ${m.name}`}>
                      {m.name} <span className="text-xs font-normal text-slate-400">· {m.warehouse || "—"}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                      {fmt(m.on_hand)} <span className="text-xs font-medium text-slate-400">/ {fmt(m.min_qty)} {m.unit}</span>
                    </span>
                  </div>
                  <div className="mt-1.5"><Bar height={6} segments={[{ pct: pct(m.on_hand, m.min_qty), color: lowColor(m) }]} /></div>
                </li>
              ))}
            </ul>
          ) : <Empty text="Không có sản phẩm nào dưới tồn tối thiểu." />}
          <button type="button" onClick={() => navigate("/inventory")} className="mt-3 text-xs font-medium text-blue-600 hover:underline">Xem tồn kho →</button>
        </Panel>
      </div>

      {/* Hàng 4 · Danh sách chi tiết theo thẻ đang chọn */}
      <div ref={listRef} className="scroll-mt-4">
        <Panel delay={440} icon={List} title="Danh sách chi tiết"
          subtitle="Bấm vào thẻ sản lượng hoặc ô trạng thái lệnh ở trên để lọc danh sách"
          action={view !== "all" && (
            <button type="button" onClick={() => setView("all")} className="text-xs font-medium text-blue-600 hover:underline">Xem tất cả lệnh</button>
          )}>
          <ProdDetail key={view} view={view} rows={detailRows} isScrap={isScrap} periodLb={periodLb} />
        </Panel>
      </div>
    </div>
  );
}

/* ───────────────────────── Tab 3 · Nhân sự ───────────────────────── */

const MEDALS = [
  "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-sm shadow-amber-500/30",
  "bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow-sm shadow-slate-400/30",
  "bg-gradient-to-br from-orange-300 to-orange-500 text-white shadow-sm shadow-orange-500/30",
];

/* 3 tiêu chí xếp hạng — CÙNG thứ tự & màu với màn Hiệu suất nhân viên */
const fmt3 = (v) => Number(v || 0).toFixed(3);
const STAFF_CRITERIA = [
  { key: "output", label: "Sản lượng", desc: "kg thành phẩm — cao nhất dẫn đầu", color: "#6366f1",
    sort: (a, b) => b.output - a.output, val: (x) => x.output, show: (v) => <>{fmt(v)} <span className="text-xs font-medium text-slate-400">kg</span></> },
  { key: "scrap", label: "Ít phế nhất", desc: "kg phế — ít nhất được vinh danh", color: "#10b981",
    sort: (a, b) => a.scrap - b.scrap, val: (x) => x.scrap, show: (v) => <>{fmt(v)} <span className="text-xs font-medium text-slate-400">kg</span></> },
  { key: "ratio", label: "Phế / 1kg thấp nhất", desc: "kg phế / kg thành phẩm — ít nhất được vinh danh", color: "#f59e0b",
    sort: (a, b) => a.scrap_ratio - b.scrap_ratio, val: (x) => x.scrap_ratio, show: (v) => fmt3(v) },
];

function StaffView({ w }) {
  const navigate = useNavigate();
  const [crit, setCrit] = useState("output");
  const cr = STAFF_CRITERIA.find((c) => c.key === crit);
  const ranked = [...(w.workers || [])].sort(cr.sort).slice(0, 5);
  const maxVal = Math.max(...ranked.map(cr.val), 0);
  const unit = <span className="ml-1.5 text-[15px] font-medium text-slate-400">kg</span>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} accent="blue" label="Công nhân có sản xuất" hint="Trong kỳ"
          value={<><Count value={w.active_count} /><span className="ml-1.5 text-[15px] font-medium text-slate-400">/ {fmt(w.worker_count)} người</span></>}
          footer={<Meter label="Tỷ lệ tham gia sản xuất" value={pct(w.active_count, w.worker_count)} color={C.intime} />} />
        <KpiCard icon={Factory} accent="violet" label="SL nhân viên làm ra" hint="Mọi công đoạn (Thổi + Cắt)" delay={70}
          value={<>{fmt(w.total_output ?? 0)}{unit}</>}
          meta={<>TB <span className="font-semibold text-slate-700">{fmt(w.avg_per_hour)}</span> kg / giờ công</>} />
        <KpiCard icon={PackageX} accent={w.total_scrap > 0 ? "rose" : "slate"} label="Tổng phế" hint="Theo Quản lý phế" delay={140}
          value={<>{fmt(w.total_scrap ?? 0)}{unit}</>} />
        <KpiCard icon={Gauge} accent="amber" label="Phế / 1kg (TB)" hint="kg phế / kg thành phẩm" delay={210}
          value={w.scrap_ratio == null ? "—" : fmt3(w.scrap_ratio)} />
      </div>

      <Panel delay={260} icon={Trophy} title="Bảng xếp hạng nhân viên" subtitle={`Top 5 · ${cr.desc}`}
        action={
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {STAFF_CRITERIA.map((c) => (
              <button key={c.key} type="button" onClick={() => setCrit(c.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${crit === c.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {c.label}
              </button>
            ))}
          </div>
        }>
        {ranked.length ? (
          <ol className="divide-y divide-slate-100">
            {ranked.map((x, i) => (
              <li key={x.worker} className="grid grid-cols-[32px_minmax(0,1.2fr)_minmax(0,2fr)_96px] items-center gap-4 py-3 first:pt-0">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${MEDALS[i] || "bg-slate-100 text-slate-500"}`}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800" title={x.worker}>{x.worker}</div>
                  <div className="truncate text-xs text-slate-400">
                    {x.team ? `${x.team} · ` : ""}{fmt(x.output)} kg · phế {fmt(x.scrap)} kg · {fmt(x.per_hour)} kg/giờ
                  </div>
                </div>
                <Bar height={8} segments={[{ pct: maxVal > 0 ? (cr.val(x) / maxVal) * 100 : 0, color: cr.color }]} />
                <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{cr.show(cr.val(x))}</span>
              </li>
            ))}
          </ol>
        ) : <Empty icon={Info} tone="text-slate-400" text="Chưa có sản lượng trong kỳ để xếp hạng." />}
        <button type="button" onClick={() => navigate("/reports/employees")} className="mt-3 text-xs font-medium text-blue-600 hover:underline">
          Xem chi tiết tại Hiệu suất nhân viên →
        </button>
      </Panel>
    </div>
  );
}

/* ───────────────────────── Trang chính ───────────────────────── */

export default function DirectorReport() {
  const [period, setPeriod] = useState("month");
  const [tab, setTab] = useState("sales");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    reports.director(period)
      .then((d) => { setData(d); setUpdatedAt(new Date()); })
      .catch((e) => toast.error("Lỗi tải báo cáo: " + e.message))
      .finally(() => setLoading(false));
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const showMoney = !!data?.can_view_amounts;
  const time = updatedAt ? updatedAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600" /> Báo cáo quản trị
          </div>
          <h2 className="mt-1.5 font-display text-[26px] font-semibold leading-tight tracking-tight text-slate-900">Báo cáo giám đốc</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            <CalendarDays size={14} className="text-slate-400" />
            <span>{period === "week" ? "Tuần này" : "Tháng này"}</span>
            {data && <><span className="text-slate-300">·</span><span className="tabular-nums">{fmtDate(data.from)} – {fmtDate(data.to)}</span></>}
            {time && <><span className="text-slate-300">·</span><span>Cập nhật lúc {time}</span></>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Chọn kỳ báo cáo" className="inline-flex items-center rounded-xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/70">
            {[["week", "Tuần"], ["month", "Tháng"]].map(([k, lb]) => (
              <button key={k} id={`dr-period-${k}`} role="tab" aria-selected={period === k} onClick={() => setPeriod(k)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${period === k ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80" : "text-slate-500 hover:text-slate-800"}`}>
                {lb}
              </button>
            ))}
          </div>
          <button id="dr-refresh" onClick={load} disabled={loading} className="btn-ghost h-[38px] disabled:opacity-60">
            <RotateCcw size={15} className={loading ? "animate-spin [animation-direction:reverse]" : ""} /> Làm mới
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex items-center gap-6 border-b border-slate-200" aria-label="Nhóm báo cáo">
        {TABS.map(({ k, label, icon: Icon }) => {
          const active = tab === k;
          return (
            <button key={k} id={`dr-tab-${k}`} onClick={() => setTab(k)} aria-current={active ? "page" : undefined}
              className={`relative -mb-px flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${active ? "border-blue-600 text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"}`}>
              <Icon size={16} className={active ? "text-blue-600" : "text-slate-400"} /> {label}
            </button>
          );
        })}
      </nav>

      {/* Nội dung */}
      {loading && !data ? <Skeleton /> : !data ? null : (
        <div key={`${tab}-${period}`} className={`transition-opacity duration-200 ${loading ? "opacity-60" : ""}`}>
          {tab === "sales" && (
            showMoney
              ? <SalesView s={data.sales} r={data.receivables || EMPTY_R} period={period} />
              : (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-16 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><Lock size={20} /></div>
                  <div className="text-sm font-medium text-slate-700">Số liệu doanh thu và công nợ được bảo mật</div>
                  <div className="text-xs text-slate-400">Chỉ hiển thị cho vai trò quản lý</div>
                </div>
              )
          )}
          {tab === "prod" && <ProdView p={data.production} period={period} />}
          {tab === "staff" && <StaffView w={data.workforce} />}
        </div>
      )}
    </div>
  );
}
