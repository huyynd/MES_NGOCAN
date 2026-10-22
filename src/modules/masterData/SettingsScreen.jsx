import React, { useState, useEffect, useCallback } from "react";
import { Save, RotateCcw } from "lucide-react";
import { ListHeader, Section, LoadError, useSaving } from "../../components.jsx";
import { appSettingsApi } from "../../mesApi.js";
import { inputCls, fmt, toast } from "../../ui.js";
import { usePerm } from "../../perm.jsx";
import { setAppSettings } from "../../appSettings.js";

/* Cài đặt hệ thống (chỉ Admin) — sửa các giá trị nghiệp vụ trong app_settings.
   Danh sách mục do backend khai báo (core/lib/settings.js); màn này chỉ hiện + kiểm + lưu. */
export default function SettingsScreen() {
  const { isAdmin } = usePerm();
  if (!isAdmin) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Chỉ Admin được xem / sửa cài đặt hệ thống.</div>;
  return <SettingsBody />;
}

// Kiểm ở trình duyệt (giống backend) để báo ngay dưới ô
function checkValue(it, v) {
  if (it.type === "text") {
    if (!String(v ?? "").trim()) return "Không được để trống";
    if (String(v).length > it.max) return `Tối đa ${it.max} ký tự`;
    return "";
  }
  if (v === "" || v == null || !Number.isFinite(Number(v))) return "Phải là số";
  const n = Number(v);
  if (it.type === "int" && !Number.isInteger(n)) return "Phải là số nguyên";
  if (n < it.min || n > it.max) return `Trong khoảng ${fmt(it.min)}–${fmt(it.max)}`;
  return "";
}

function SettingsBody() {
  const [items, setItems] = useState(null);
  const [vals, setVals] = useState({});
  const [loadErr, setLoadErr] = useState("");
  const [saving, guard] = useSaving();

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const list = await appSettingsApi.list();
      setItems(list);
      setVals(Object.fromEntries(list.map((it) => [it.key, it.value])));
    } catch (e) { setLoadErr(e.message || "Lỗi máy chủ"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loadErr) return <LoadError className="mt-6" message={`Không tải được cài đặt (${loadErr})`} onRetry={load} />;
  if (!items) return <div className="text-slate-400 text-sm py-10">Đang tải…</div>;

  const errors = Object.fromEntries(items.map((it) => [it.key, checkValue(it, vals[it.key])]));
  const changed = items.filter((it) => String(vals[it.key]) !== String(it.value));
  const groups = [...new Set(items.map((it) => it.group))];

  const save = async () => {
    const bad = changed.filter((it) => errors[it.key]);
    if (bad.length) return toast.error(`Kiểm tra lại: ${bad.map((it) => it.label).join(", ")}`);
    if (!changed.length) return toast("Không có thay đổi");
    try {
      const r = await appSettingsApi.save(Object.fromEntries(changed.map((it) => [it.key, vals[it.key]])));
      setAppSettings(r.values); // có hiệu lực ngay cho các màn khác
      toast.success(r.message || "Đã lưu cài đặt");
      await load();
    } catch (e) { toast.error("Lỗi lưu cài đặt: " + e.message); }
  };

  return (
    <div className="space-y-5">
      <ListHeader title="Cài đặt hệ thống" subtitle="Giá trị dùng chung cho toàn app · chỉ Admin"
        actions={<>
          <button onClick={() => setVals(Object.fromEntries(items.map((it) => [it.key, it.value])))} disabled={!changed.length || saving} className="btn-ghost"><RotateCcw size={16} /> Hoàn tác</button>
          <button onClick={() => guard(save)} disabled={saving || !changed.length} className="btn-primary disabled:opacity-60"><Save size={16} /> {saving ? "Đang lưu…" : changed.length ? `Lưu (${changed.length} thay đổi)` : "Lưu"}</button>
        </>} />
      <Section title="Thông số" bodyClass="p-0">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {groups.map((g) => (
              <React.Fragment key={g}>
                <tr className="bg-slate-50/70"><td colSpan={3} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</td></tr>
                {items.filter((it) => it.group === g).map((it) => {
                  const err = errors[it.key], isChanged = String(vals[it.key]) !== String(it.value);
                  return (
                    <tr key={it.key}>
                      <td className="px-4 py-2.5 w-1/2 align-top">
                        <label htmlFor={`st-${it.key}`} className="text-slate-700">{it.label}</label>
                        {it.hint && <div className="text-xs text-slate-400 mt-0.5">{it.hint}</div>}
                      </td>
                      <td className="px-4 py-2 align-top">
                        <input id={`st-${it.key}`} className={inputCls + (err ? " border-rose-300" : isChanged ? " border-blue-300" : "")}
                          type={it.type === "text" ? "text" : "number"} step={it.type === "int" ? 1 : "any"}
                          min={it.type === "text" ? undefined : it.min} max={it.type === "text" ? undefined : it.max}
                          value={vals[it.key] ?? ""} onChange={(e) => setVals((s) => ({ ...s, [it.key]: e.target.value }))} />
                        {err && <div className="text-xs text-rose-600 mt-1">{err}</div>}
                      </td>
                      <td className="px-4 py-2.5 align-top text-xs text-slate-400 whitespace-nowrap w-40">
                        Mặc định: {it.type === "text" ? "—" : fmt(it.default)}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
