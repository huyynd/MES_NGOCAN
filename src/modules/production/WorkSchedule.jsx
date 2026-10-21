import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Pencil, Check, X } from "lucide-react";
import { ListHeader, useSaving } from "../../components.jsx";
import { workSchedules } from "../../mesApi.js";
import {  inputCls , toast } from "../../ui.js";
import { usePerm } from "../../perm.jsx";

const d = (ymd) => new Date(ymd + "T00:00:00");
const toYMD = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (ymd, n) => { const x = d(ymd); x.setDate(x.getDate() + n); return toYMD(x); };
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

// thứ 2 đầu tuần của hôm nay
function mondayOf(date) {
  const x = new Date(date); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day);
  return toYMD(x);
}

export default function WorkScheduleModule({ lookups }) {
  const [anchor, setAnchor] = useState(mondayOf(new Date()));
  const [map, setMap] = useState({}); // `${emp}|${date}` -> shift_id
  const [isEditing, setIsEditing] = useState(false);
  const [pendingChanges, setPendingChanges] = useState({});
  const pendingRef = React.useRef(pendingChanges); pendingRef.current = pendingChanges;
  const pendingCount = Object.keys(pendingChanges).length;
  const [saving, guard] = useSaving();
  // P-13: đổi tuần khi còn thay đổi chưa lưu → hỏi (thay đổi được giữ, Lưu sẽ lưu cả các tuần)
  const goWeek = (a) => {
    if (pendingCount && !confirm(`Đang có ${pendingCount} ô đã đổi chưa lưu. Các thay đổi vẫn được giữ và sẽ lưu cùng khi bấm Lưu.
Chuyển tuần?`)) return;
    setAnchor(a);
  };
  const { can } = usePerm();
  const canEdit = can("workschedule", "edit");
  const employees = lookups.employees || [];
  const shiftList = lookups.shiftList || [];
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);

  const load = useCallback(async () => {
    try {
      const rows = await workSchedules.list(days[0], days[6]);
      const m = {};
      rows.forEach((r) => { 
        m[`${r.employee_id}|${r.work_date}`] = {
          shift_id: r.shift_id,
          has_attendance: !!(r.check_in_at || r.check_out_at)
        }; 
      });
      // giữ hiển thị các ô đã đổi chưa lưu (khi quay lại tuần đã sửa)
      Object.entries(pendingRef.current).forEach(([k, c]) => { m[k] = { ...m[k], shift_id: c.shift_id || undefined }; });
      setMap(m);
    } catch (e) { toast.error("Lỗi tải lịch: " + e.message); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const handleChange = (employee_id, work_date, shift_id) => {
    setMap((m) => ({ ...m, [`${employee_id}|${work_date}`]: { ...m[`${employee_id}|${work_date}`], shift_id: shift_id || undefined } }));
    setPendingChanges((p) => ({ ...p, [`${employee_id}|${work_date}`]: { employee_id, work_date, shift_id: shift_id || null } }));
  };

  const handleSave = async () => {
    const changes = Object.values(pendingChanges);
    if (changes.length === 0) {
      setIsEditing(false);
      return;
    }
    const toastId = toast.loading("Đang lưu lịch làm việc...");
    try {
      await workSchedules.bulkUpsert(changes);
      toast.success("Đã lưu lịch làm việc", { id: toastId });
      setPendingChanges({});
      setIsEditing(false);
      load();
    } catch (e) {
      toast.error("Lỗi lưu: " + (e.message || "Lỗi máy chủ"), { id: toastId });
    }
  };

  const handleCancel = () => {
    setPendingChanges({});
    setIsEditing(false);
    load();
  };

  // gom nhân viên theo đơn vị
  const groups = useMemo(() => {
    const g = {};
    employees.forEach((e) => { (g[e.factory || "Khác"] = g[e.factory || "Khác"] || []).push(e); });
    return Object.entries(g);
  }, [employees]);

  return (
    <div className="space-y-5">
      <ListHeader title="Lịch làm việc" actions={<>
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
            <button 
              onClick={() => goWeek(addDays(anchor, -7))}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition"
              title="Tuần trước"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="px-2 py-1.5 text-sm font-medium text-slate-700 min-w-[120px] text-center">
              Tuần {d(days[0]).getDate()}/{d(days[0]).getMonth() + 1} – {d(days[6]).getDate()}/{d(days[6]).getMonth() + 1}
            </span>
            <button 
              onClick={() => goWeek(addDays(anchor, 7))}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition"
              title="Tuần sau"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button 
            onClick={() => goWeek(mondayOf(new Date()))}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition ${anchor === mondayOf(new Date()) ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            Tuần này
          </button>
        </div>
        <div className="w-px h-6 bg-slate-200 mx-2"></div>
        <button onClick={load} className="btn-ghost" disabled={isEditing}><RotateCcw size={16} /> Làm mới</button>
        <div className="w-px h-6 bg-slate-200 mx-1"></div>
        {canEdit && (!isEditing ? (
          <button onClick={() => setIsEditing(true)} className="btn-primary flex items-center gap-2">
            <Pencil size={16} /> Sửa
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={handleCancel} className="btn-ghost text-slate-500 hover:text-slate-700">
              <X size={16} /> Hủy
            </button>
            <button onClick={() => guard(handleSave)} disabled={saving} className="btn-primary flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 border-emerald-600">
              <Check size={16} /> {saving ? "Đang lưu…" : pendingCount ? `Lưu (${pendingCount} thay đổi)` : "Lưu"}
            </button>
          </div>
        ))}
      </>} />

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-4 py-2 font-semibold text-slate-500 text-xs uppercase border-r border-slate-200 w-52">Nhân viên</th>
              {days.map((dy) => {
                const wd = d(dy).getDay(); const weekend = wd === 0 || wd === 6;
                return <th key={dy} className={`px-2 py-2 text-center text-xs border-r border-slate-100 ${weekend ? "bg-slate-100/60" : ""}`}>
                  <div className="text-slate-400">{WD[wd]}</div><div className="font-medium text-slate-600">{d(dy).getDate()}/{d(dy).getMonth() + 1}</div>
                </th>;
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map(([factory, emps]) => (
              <React.Fragment key={factory}>
                <tr className="bg-slate-50/60"><td colSpan={8} className="px-4 py-1.5 text-xs font-semibold text-slate-500">{factory}</td></tr>
                {emps.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 border-r border-slate-200">
                      <div className="font-medium text-slate-800">{e.name}</div>
                      <div className="text-[11px] text-slate-400">{e.employee_code}{e.skill_level ? ` · ${e.skill_level}` : ""}</div>
                    </td>
                    {days.map((dy) => {
                      const cell = map[`${e.id}|${dy}`] || {};
                      const val = cell.shift_id || "";
                      
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const wDate = d(dy);
                      const diffDays = Math.floor((today - wDate) / (1000 * 60 * 60 * 24));
                      const isLocked = cell.has_attendance || diffDays > 3;

                      return (
                        <td key={dy} className="px-1.5 py-1.5 border-r border-slate-100">
                          <select value={val} onChange={(ev) => handleChange(e.id, dy, ev.target.value)}
                            disabled={!isEditing || isLocked}
                            className={`${inputCls} px-1.5 py-1 text-xs ${val ? "bg-blue-50 border-blue-200 text-blue-700 font-medium" : "text-slate-400"} ${(!isEditing || isLocked) ? "opacity-60 cursor-not-allowed bg-slate-100" : ""}`}>
                            <option value="">—</option>
                            {shiftList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
            {!employees.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Chưa có nhân viên. Thêm ở Danh mục → Nhân viên.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
