import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ShoppingCart, Factory, Users, AlertTriangle, RotateCcw, Wallet, Truck, Clock,
  CalendarDays, Lightbulb, Trophy, PackageCheck, PackageX, ClipboardList, Gauge,
  Lock, CheckCircle2, Receipt, Info, X, ExternalLink,
} from "lucide-react";
import { reports } from "../../mesApi.js";
import { fmt, fmtDate, toast } from "../../ui.js";

/* ───────────────────────── Bảng màu & hằng số ───────────────────────── */

/* Nhóm tuổi nợ: khóa dữ liệu · nhãn · màu (tuần tự lạnh → nóng) */
const AGE = [
  { key: "lt6m", label: "< 6 tháng", color: "#38bdf8" },
  { key: "m6_12", label: "6–12 tháng", color: "#f59e0b" },
  { key: "y1_2", label: "1–2 năm", color: "#f97316" },
  { key: "gt2", label: "> 2 năm", color: "#e11d48" },
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

const EMPTY_R = {
  overdue_days: 30, total_debt: 0, billed_total: 0, collected_total: 0, customer_count: 0,
  overdue_amount: 0, intime_amount: 0, overdue_count: 0, buckets: {}, by_customer: [],
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

function KpiCard({ icon: Icon, accent = "blue", label, hint, value, valueClass, meta, footer, delay = 0, onClick }) {
  const a = ACCENTS[accent];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card transition-all duration-300 animate-rise motion-reduce:animate-none text-left ${onClick ? "cursor-pointer hover:-translate-y-1 hover:shadow-card-hover hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40" : "hover:-translate-y-0.5 hover:shadow-card-hover"}`}
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
      <div className={`relative mt-4 font-display font-semibold leading-none tracking-tight text-slate-900 tabular-nums ${valueClass || "text-[30px]"}`}>
        {value}
      </div>
      {meta && <div className="relative mt-2 text-[13px] text-slate-500">{meta}</div>}
      {footer && <div className="relative mt-auto pt-4"><div className="border-t border-slate-100 pt-3.5">{footer}</div></div>}
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
  if ((r.buckets?.gt2 || 0) > 0) {
    insights.push({
      tone: "bad", icon: Clock,
      title: `${short(r.buckets.gt2)} nợ trên 2 năm`,
      text: "Nguy cơ nợ khó đòi — cân nhắc trích lập dự phòng",
    });
  }
  if (r.billed_total > 0) {
    insights.push({
      tone: collectRate >= 85 ? "good" : collectRate >= 60 ? "warn" : "bad", icon: Wallet,
      title: `Thu hồi lũy kế đạt ${collectRate}%`,
      text: `${short(r.collected_total)} trên ${short(r.billed_total)} đã xuất hóa đơn`,
    });
  }

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
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
        <KpiCard
          icon={Truck} accent="emerald" label="Tiến độ giao hàng" hint={periodLb} delay={70}
          onClick={() => setOrdersModal(true)}
          value={<><Count value={s.shipped_count} /><span className="ml-1.5 text-[15px] font-medium text-slate-400">/ {fmt(s.order_count)} đơn</span></>}
          meta={<><span className="font-semibold text-slate-700">{fmt(s.fully_count)}</span> đơn đã giao đủ</>}
          footer={<Meter label="Tỷ lệ đơn đã xuất giao" value={shipRate} color={C.good} />}
        />
        <KpiCard
          icon={Receipt} accent="violet" label="Tiền đã thu" hint="Lũy kế đến hôm nay" delay={140}
          onClick={() => setDeliveriesModal(true)}
          value={<Money value={r.collected_total} />}
          meta={<>trên <span className="font-semibold text-slate-700" title={full(r.billed_total)}>{short(r.billed_total)}</span> đã xuất hóa đơn</>}
          footer={<Meter label="Tỷ lệ thu hồi" value={collectRate} color={C.violet} />}
        />
        <KpiCard
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

      {/* Điểm nhấn */}
      {insights.length > 0 && (
        <Panel title="Điểm nhấn cho lãnh đạo" subtitle="Tự động rút ra từ số liệu công nợ hiện tại" icon={Lightbulb} delay={260}>
          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${insights.length >= 4 ? "xl:grid-cols-4" : insights.length === 3 ? "xl:grid-cols-3" : ""}`}>
            {insights.map((it, i) => {
              const t = TONES[it.tone];
              const Icon = it.icon;
              return (
                <div key={i} className="relative flex flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white p-4 pl-5 transition-shadow hover:shadow-card-hover">
                  <span className={`absolute inset-y-0 left-0 w-1 ${t.stripe}`} />
                  <div className="flex items-center justify-between gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.icon}`}><Icon size={16} /></div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${t.pill}`}>{t.label}</span>
                  </div>
                  <div className="mt-3 text-sm font-semibold leading-snug text-slate-900">{it.title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-500">{it.text}</div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

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

function ProdView({ p, period }) {
  const periodLb = period === "week" ? "Tuần này" : "Tháng này";
  const enoughPct = pct(p.enough_count, p.active_count);
  const sevColor = (kg) => (kg < 250 ? C.overdue : kg < 500 ? "#f97316" : "#f59e0b");
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard icon={ClipboardList} accent="blue" label="Yêu cầu sản xuất" hint={periodLb}
          value={<><Count value={p.request_count} /><span className="ml-1.5 text-[15px] font-medium text-slate-400">lệnh</span></>}
          meta={<><span className="font-semibold text-slate-700">{fmt(p.active_count)}</span> lệnh đang mở</>} />
        <KpiCard icon={PackageCheck} accent="emerald" label="Lệnh đủ nguyên vật liệu" hint="Lệnh đang mở" delay={70}
          value={<><Count value={p.enough_count} /><span className="ml-1.5 text-[15px] font-medium text-slate-400">/ {fmt(p.active_count)}</span></>}
          footer={<Meter label="Sẵn sàng sản xuất" value={enoughPct} color={C.good} />} />
        <KpiCard icon={PackageX} accent={p.short_count > 0 ? "rose" : "slate"} label="Lệnh thiếu nguyên vật liệu" hint="Cần bổ sung" delay={140}
          value={<span className={p.short_count > 0 ? "text-rose-600" : ""}><Count value={p.short_count} /><span className="ml-1.5 text-[15px] font-medium text-slate-400">lệnh</span></span>}
          meta={p.short_count > 0 ? "Ảnh hưởng tiến độ — cần mua bổ sung" : "Không có lệnh nào bị thiếu"} />
      </div>

      <Panel delay={220} icon={AlertTriangle} title="Cảnh báo tồn NVL dưới 1 tấn"
        subtitle="Chỉ xét NVL tính bằng kg · thanh đầy = 1.000 kg"
        action={<Legend items={[{ label: "< 250 kg", color: C.overdue }, { label: "< 500 kg", color: "#f97316" }, { label: "< 1.000 kg", color: "#f59e0b" }]} />}>
        {p.low_materials.length ? (
          <ul className="divide-y divide-slate-100">
            {p.low_materials.map((m) => (
              <li key={m.name} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_96px] items-center gap-4 py-2.5 first:pt-0">
                <span className="truncate text-sm font-medium text-slate-800" title={m.name}>{m.name}</span>
                <Bar height={8} segments={[{ pct: (m.on_hand / 1000) * 100, color: sevColor(m.on_hand) }]} />
                <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{fmt(m.on_hand)} <span className="text-xs font-medium text-slate-400">{m.unit}</span></span>
              </li>
            ))}
          </ul>
        ) : <Empty text="Không có NVL (kg) nào dưới 1 tấn." />}
      </Panel>
    </div>
  );
}

/* ───────────────────────── Tab 3 · Nhân sự ───────────────────────── */

const MEDALS = [
  "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-sm shadow-amber-500/30",
  "bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow-sm shadow-slate-400/30",
  "bg-gradient-to-br from-orange-300 to-orange-500 text-white shadow-sm shadow-orange-500/30",
];

function StaffView({ w }) {
  const maxHour = Math.max(1, ...(w.top || []).map((x) => x.per_hour));
  const champ = w.top[0];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard icon={Users} accent="blue" label="Công nhân trong xưởng" hint="Đang làm việc"
          value={<><Count value={w.worker_count} /><span className="ml-1.5 text-[15px] font-medium text-slate-400">người</span></>} />
        <KpiCard icon={Gauge} accent="violet" label="Năng suất trung bình" hint="Toàn xưởng" delay={70}
          value={<><Count value={w.avg_per_hour} /><span className="ml-1.5 text-[15px] font-medium text-slate-400">sp / giờ</span></>} />
        <KpiCard icon={Trophy} accent="amber" label="Quán quân năng suất" hint="Trong kỳ" delay={140}
          valueClass="text-[22px] truncate"
          value={<span title={champ?.worker}>{champ?.worker || "—"}</span>}
          meta={champ ? <><span className="font-semibold text-slate-700">{fmt(champ.per_hour)}</span> sp/giờ · {fmt(champ.output)} sp</> : "Chưa có dữ liệu"} />
      </div>

      <Panel delay={220} icon={Trophy} title="Bảng xếp hạng năng suất" subtitle="Sản phẩm / giờ công · giờ công tính 8 giờ/ngày có làm việc">
        {w.top.length ? (
          <ol className="divide-y divide-slate-100">
            {w.top.map((x, i) => (
              <li key={x.worker} className="grid grid-cols-[32px_minmax(0,1.2fr)_minmax(0,2fr)_96px] items-center gap-4 py-3 first:pt-0">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${MEDALS[i] || "bg-slate-100 text-slate-500"}`}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800" title={x.worker}>{x.worker}</div>
                  <div className="text-xs text-slate-400">{fmt(x.output)} sản phẩm</div>
                </div>
                <Bar height={8} segments={[{ pct: (x.per_hour / maxHour) * 100, color: i === 0 ? "#f59e0b" : C.violet }]} />
                <span className="text-right text-sm font-semibold tabular-nums text-slate-900">{fmt(x.per_hour)} <span className="text-xs font-medium text-slate-400">sp/h</span></span>
              </li>
            ))}
          </ol>
        ) : <Empty icon={Info} tone="text-slate-400" text="Chưa có sản lượng trong kỳ để xếp hạng." />}
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
