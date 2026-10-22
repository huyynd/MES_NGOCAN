// src/modules/sales/debtUi.jsx — thành phần dùng chung cho Phiếu thanh toán / Công nợ / Phiếu giao
import React from "react";
import { AlertTriangle, Ban, CheckCircle2, Clock } from "lucide-react";
import { inputCls, fmt } from "../../ui.js";

// Định dạng tiền VNĐ: 1234567 → "1.234.567"
export const vnd = (v) => Math.round(Number(v) || 0).toLocaleString("vi-VN");

// Ô nhập tiền: gõ số, tự chèn dấu chấm mỗi 3 số 0. value / onChange dùng SỐ (không dấu).
export function MoneyInput({ value, onChange, className = "", ...rest }) {
  const shown = value === "" || value == null ? "" : vnd(value);
  return (
    <div className="relative">
      <input
        {...rest}
        inputMode="numeric"
        className={(className || inputCls) + " text-right pr-9 font-semibold tabular-nums"}
        value={shown}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 15);
          onChange(digits === "" ? "" : Number(digits));
        }}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">đ</span>
    </div>
  );
}

// Mức công nợ của khách (backend trả level): ok | debt | bad | blocked
export const LEVELS = {
  ok:      { label: "Không nợ",         cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  debt:    { label: "Đang nợ",          cls: "bg-amber-50 text-amber-700 border-amber-200",       icon: Clock },
  bad:     { label: "Nợ xấu",           cls: "bg-rose-50 text-rose-700 border-rose-200",          icon: AlertTriangle },
  blocked: { label: "Vượt hạn mức",     cls: "bg-rose-600 text-white border-rose-600",            icon: Ban },
};
export function LevelBadge({ level }) {
  const L = LEVELS[level] || LEVELS.ok;
  const Icon = L.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${L.cls}`}>
      <Icon size={12} /> {L.label}
    </span>
  );
}

// Khung cảnh báo công nợ khi chọn khách (Phiếu giao / Phiếu thanh toán). info = kết quả paymentReceipts.customer()
export function DebtBanner({ info, context = "delivery" }) {
  if (!info || !["bad", "blocked"].includes(info.level)) return null;
  const s = info.settings || {};
  const hidden = info.amounts_hidden;
  const blocked = info.level === "blocked";
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${blocked ? "border-rose-300 bg-rose-50 text-rose-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
      {blocked ? <Ban size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
      <div>
        <div className="font-semibold">
          {blocked
            ? (context === "delivery" ? "Khách nợ vượt hạn mức — không thể tạo phiếu giao mới" : "Khách nợ vượt hạn mức")
            : "Khách đang nợ xấu"}
        </div>
        <div className="mt-0.5">
          {hidden
            ? `Có phiếu giao chưa thanh toán đủ ${info.oldest_days ? `(lâu nhất ${info.oldest_days} ngày)` : ""}. Liên hệ kế toán để biết số tiền.`
            : <>
                Đang nợ <b>{fmt(info.debt)} đ</b>
                {info.overdue_debt > 0 && <> — trong đó <b>{fmt(info.overdue_debt)} đ</b> quá {s.bad_days ?? "—"} ngày (lâu nhất {info.oldest_days} ngày)</>}
                {blocked && <>. Hạn mức: {s.limit_amount != null ? `${fmt(s.limit_amount)} đ` : "—"}</>}.
              </>}
          {blocked && context === "delivery" && " Cần lập Phiếu thanh toán thu bớt nợ trước."}
        </div>
      </div>
    </div>
  );
}
