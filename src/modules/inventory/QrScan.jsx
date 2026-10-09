import React, { useState, useRef, useEffect } from "react";
import { Search, CheckCircle2, Info } from "lucide-react";
import { ListHeader } from "../../components.jsx";
import { production } from "../../mesApi.js";
import {  inputCls, fmt, fmtDate, statusClass , toast } from "../../ui.js";

const TASK_RE = /(LSX\d+-\d+)/i;

// CHỈ TRA CỨU (chỉ đọc). Việc ghi SL thực / Hoàn thành chỉ làm ở màn Chi tiết lệnh sản xuất
// (thiết kế §8c) — backend cũng đã chặn updateTask ghi actual_qty / chuyển Hoàn thành.
export default function QrScanModule() {
  const [input, setInput] = useState("");
  const [task, setTask] = useState(null);
  const [log, setLog] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const lookup = async (raw) => {
    const code = (raw.match(TASK_RE)?.[1] || raw.trim()).toUpperCase();
    setInput("");
    if (!code) return;
    try {
      const t = await production.taskByCode(code);
      setTask(t);
      setLog((l) => [{ code: t.task_code, status: t.status, time: new Date().toLocaleTimeString("vi-VN") }, ...l].slice(0, 12));
    } catch (e) { setTask(null); toast.error(e.message); inputRef.current?.focus(); }
  };

  return (
    <div className="space-y-5">
      <ListHeader title="Tra cứu mã truy xuất" />

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={inputRef} className={inputCls + " pl-10"} value={input} placeholder="Nhập mã truy xuất — ví dụ: LSX00004-1 — rồi ấn Enter"
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(input); } }} />
          </div>
          <button onClick={() => lookup(input)} className="btn-primary">Tra cứu</button>
        </div>
      </div>

      {task && (
        <div className="bg-white rounded-xl border border-blue-200 overflow-hidden">
          <div className="px-5 py-3 bg-blue-50/60 border-b border-blue-100 flex items-center justify-between">
            <span className="font-semibold text-slate-800">Lô {task.task_code} · {task.stage} ({task.stage === "Cắt" ? "TP" : "BTP"})</span>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(task.status)}`}>{task.status}</span>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-slate-400">Lệnh SX:</span> <b>{task.order_code}</b></div>
              <div><span className="text-slate-400">Đơn hàng:</span> <b>{task.sales_order_code || "—"}</b></div>
              <div><span className="text-slate-400">Khách:</span> {task.customer_name || "—"}</div>
              <div><span className="text-slate-400">Sản phẩm:</span> <b>{task.product_name}</b></div>
              <div><span className="text-slate-400">Màu/KT/Dày:</span> {[task.attr_color, task.attr_size, task.attr_thickness].filter(Boolean).join(" / ") || "—"}</div>
              <div><span className="text-slate-400">Máy:</span> {task.machine_name || "—"}</div>
              <div><span className="text-slate-400">SL kế hoạch:</span> <b>{fmt(task.quantity)} {task.unit}</b></div>
              <div><span className="text-slate-400">Ngày SX:</span> {fmtDate(task.planned_date)}</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm pt-2 border-t border-slate-100">
              <div><span className="text-slate-400">SL thực tế:</span> <b>{task.actual_qty != null && task.actual_qty !== "" ? fmt(task.actual_qty) : "—"} {task.unit}</b></div>
              <div><span className="text-slate-400">Đội:</span> {task.assigned_team || "—"}</div>
              <div><span className="text-slate-400">Công nhân:</span> {task.assigned_worker || "—"}</div>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-500">
              <Info size={14} className="shrink-0 mt-0.5" />
              Màn này chỉ để <b className="mx-1">tra cứu</b>. Ghi sản lượng thực và Hoàn thành công đoạn thực hiện ở
              <b className="mx-1">Chi tiết lệnh sản xuất</b>.
            </div>
            <div className="flex justify-end">
              <button onClick={() => setTask(null)} className="btn-ghost">Đóng</button>
            </div>
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 text-sm font-semibold text-slate-700">Lần tra cứu gần đây</div>
          <div className="divide-y divide-slate-100">
            {log.map((l, i) => (
              <div key={i} className="px-5 py-2.5 text-sm flex items-center gap-3">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="font-medium text-blue-600">{l.code}</span>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(l.status)}`}>{l.status}</span>
                <span className="text-slate-400 ml-auto">{l.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
