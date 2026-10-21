// Bộ ô nhập 5 thông số kỹ thuật (Số lớp · Rộng · Dài · Độ dày · Màu) — DÙNG CHUNG cho Đơn hàng và Lệnh SX
// để hai nơi lưu thông số cùng một kiểu (specs object), không lệch spec_key.
import React from "react";
import { inputCls } from "./ui.js";
import { PRODUCT_SPECS, splitNU } from "./specs.js";

export function SpecFields({ specs, onChange, disabled }) {
  const get = (n) => specs?.[n] || "";
  const setV = (n, v) => { const next = { ...specs }; if (v) next[n] = v; else delete next[n]; onChange(next); };
  const cls = inputCls + (disabled ? " bg-slate-50" : "");
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {PRODUCT_SPECS.map((spec) => {
        const lbl = <span className="block text-xs font-medium text-slate-500 mb-1">{spec.label || spec.name}</span>;
        if (spec.kind === "text") return (
          <label key={spec.name}>{lbl}
            <input className={cls} disabled={disabled} value={get(spec.name)} placeholder={spec.placeholder || ""}
              onChange={(e) => setV(spec.name, e.target.value)} />
          </label>
        );
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
        const { num, unit } = splitNU(get(spec.name)); const cu = unit || spec.units[0];
        // Bỏ "w-full" của inputCls: trong flex nó ép ô số co lại chỉ còn mũi tên tăng/giảm
        const clsFlex = cls.replace("w-full ", "");
        return (
          <label key={spec.name}>{lbl}
            <div className="flex gap-1.5">
              <input type="number" step="any" className={clsFlex + " flex-1 min-w-0 no-spin"} disabled={disabled} value={num} placeholder="0"
                onChange={(e) => setV(spec.name, e.target.value ? `${e.target.value} ${cu}` : "")} />
              <select className={clsFlex + " w-[4.5rem] shrink-0 px-2"} disabled={disabled} value={cu}
                onChange={(e) => setV(spec.name, num ? `${num} ${e.target.value}` : "")}>
                {spec.units.map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
          </label>
        );
      })}
    </div>
  );
}
