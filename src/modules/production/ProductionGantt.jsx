import React, { useState, useEffect, useCallback, useMemo } from "react";
import { LoadError, DateInput } from "../../components.jsx";
import { toast } from "../../ui.js";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { production } from "../../mesApi.js";
import { fmt, fmtDate } from "../../ui.js";

const d = (ymd) => new Date(ymd + "T00:00:00");
const toYMD = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const diffDays = (a, b) => Math.round((d(b) - d(a)) / 86400000);
const addDays = (ymd, n) => { const x = d(ymd); x.setDate(x.getDate() + n); return toYMD(x); };
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

// màu theo trạng thái phân công
const STATUS_BAR = {
  "Chờ": "bg-slate-400",
  "Đang sản xuất": "bg-amber-500",
  "Hoàn thành": "bg-emerald-500",
  "Đã hủy": "bg-rose-400",
};
const LEGEND = [
  { s: "Chờ", c: "bg-slate-400" },
  { s: "Đang sản xuất", c: "bg-amber-500" },
  { s: "Hoàn thành", c: "bg-emerald-500" },
  { s: "Đã hủy", c: "bg-rose-400" },
];

export default function ProductionGantt({ onOpenOrder }) {
  const [all, setAll] = useState([]);
  const [anchor, setAnchor] = useState(null); // ngày bắt đầu khung nhìn
  const [span, setSpan] = useState(14);
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await production.gantt("", "");
      setAll(rows);
      if (rows.length) {
        const earliest = rows.map((r) => r.start_date).sort()[0];
        setAnchor((a) => a || earliest);
      } else setAnchor((a) => a || toYMD(new Date()));
      setLoadErr("");
    } catch (e) { setLoadErr(e.message || "Lỗi máy chủ"); toast.error("Lỗi tải Gantt: " + e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => (anchor ? Array.from({ length: span }, (_, i) => addDays(anchor, i)) : []), [anchor, span]);

  // gom theo máy (đơn vị sản xuất)
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of all) {
      const key = t.machine_id || "none";
      if (!m.has(key)) m.set(key, { key, name: t.machine_name || "Chưa xếp máy", factory: t.machine_factory || "", tasks: [] });
      m.get(key).tasks.push(t);
    }
    return [...m.values()].sort((a, b) => (a.factory + a.name).localeCompare(b.factory + b.name));
  }, [all]);

  if (!anchor) return loadErr
    ? <LoadError className="mt-6" message={`Không tải được biểu đồ Gantt (${loadErr})`} onRetry={() => { setLoadErr(""); load(); }} />
    : <div className="text-slate-400 text-sm py-10">Đang tải biểu đồ…</div>;
  const from = days[0], to = days[span - 1];

  const barOf = (t) => {
    const s = Math.max(0, diffDays(from, t.start_date));
    const e = Math.min(span, diffDays(from, t.end_date) + 1);
    if (e <= 0 || s >= span) return null;
    const left = Math.max(0, s);
    return { left: (left / span) * 100, width: ((e - left) / span) * 100 };
  };

  return (
    <div className="space-y-4">
      {/* Thanh điều khiển */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => setAnchor(addDays(anchor, -span))} className="btn-ghost px-2"><ChevronLeft size={16} /></button>
          <span className="text-sm font-medium text-slate-700">{fmtDate(from)} → {fmtDate(to)}</span>
          <button onClick={() => setAnchor(addDays(anchor, span))} className="btn-ghost px-2"><ChevronRight size={16} /></button>
          <DateInput value={anchor} onChange={(e) => setAnchor(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-slate-300 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          {[[7, "Tuần"], [14, "2 tuần"], [30, "Tháng"]].map(([n, lb]) => (
            <button key={n} onClick={() => setSpan(n)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${span === n ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{lb}</button>
          ))}
          <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        </div>
      </div>

      {/* Chú giải */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        {LEGEND.map((l) => <span key={l.s} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded ${l.c}`} />{l.s}</span>)}
      </div>

      {/* Biểu đồ */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Header ngày */}
          <div className="flex border-b border-slate-200 bg-slate-50 sticky top-0">
            <div className="w-48 shrink-0 px-4 py-2 text-xs font-semibold text-slate-500 uppercase border-r border-slate-200">Đơn vị sản xuất</div>
            <div className="flex-1 flex">
              {days.map((dy) => {
                const wd = d(dy).getDay();
                const weekend = wd === 0 || wd === 6;
                return (
                  <div key={dy} className={`flex-1 text-center py-2 border-r border-slate-100 text-xs ${weekend ? "bg-slate-100/60" : ""}`}>
                    <div className="text-slate-400">{WD[wd]}</div>
                    <div className="font-medium text-slate-600">{d(dy).getDate()}/{d(dy).getMonth() + 1}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hàng theo máy */}
          {!groups.length && <div className="px-4 py-10 text-center text-slate-400 text-sm">Chưa có phân công nào có ngày sản xuất.</div>}
          {groups.map((g) => (
            <div key={g.key} className="flex border-b border-slate-100">
              <div className="w-48 shrink-0 px-4 py-3 border-r border-slate-200">
                <div className="font-medium text-slate-800 text-sm">{g.name}</div>
                {g.factory && <div className="text-[11px] text-slate-400">{g.factory}</div>}
              </div>
              <div className="flex-1 relative" style={{ minHeight: 44 }}>
                {/* gridlines */}
                <div className="absolute inset-0 flex">
                  {days.map((dy) => { const wd = d(dy).getDay(); return <div key={dy} className={`flex-1 border-r border-slate-100 ${wd === 0 || wd === 6 ? "bg-slate-50/50" : ""}`} />; })}
                </div>
                {/* thanh công việc */}
                {g.tasks.map((t) => {
                  const b = barOf(t);
                  if (!b) return null;
                  return (
                    <button key={t.id} onClick={() => onOpenOrder?.(t.production_order_id)}
                      title={`${t.task_code} · ${t.stage} · ${t.product_name} · ${fmt(t.quantity)} · ${t.status}\n${fmtDate(t.start_date)} → ${fmtDate(t.end_date)}${t.shift ? " · " + t.shift : ""}${t.assigned_team ? " · " + t.assigned_team : ""}`}
                      className={`absolute top-2 h-7 rounded px-2 text-[11px] text-white font-medium flex items-center overflow-hidden whitespace-nowrap hover:brightness-95 ${STATUS_BAR[t.status] || "bg-slate-400"}`}
                      style={{ left: `${b.left}%`, width: `calc(${b.width}% - 4px)`, marginLeft: 2 }}>
                      {t.order_code} · {fmt(t.quantity)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
