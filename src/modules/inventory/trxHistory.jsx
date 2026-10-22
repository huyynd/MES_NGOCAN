// Dùng chung cho các màn lịch sử giao dịch kho (K-19, K-20)
import React from "react";
import { DateInput } from "../../components.jsx";
import { inputCls } from "../../ui.js";

// Giao dịch làm TĂNG tồn? Theo delta có dấu; bản ghi cũ chưa có delta thì suy từ loại.
export const trxIsIn = (t) => (t.delta != null ? Number(t.delta) > 0 : t.trx_type !== "Xuất");

export const TRX_COLOR = {
  "Nhập": "bg-emerald-50 text-emerald-700", "Xuất": "bg-rose-50 text-rose-700",
  "Điều chỉnh": "bg-amber-50 text-amber-700", "Chuyển kho": "bg-blue-50 text-blue-700",
};

// Mặc định 30 ngày gần nhất (trước đây chỉ thấy 300 dòng mới nhất, không xem được dữ liệu cũ hơn)
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const defaultRange = () => ({ date_from: ymd(new Date(Date.now() - 29 * 86400000)), date_to: ymd(new Date()) });

export function TrxRange({ value, onChange }) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-slate-500">
      <DateInput className={inputCls + " !w-36 !py-1"} value={value.date_from}
        onChange={(e) => onChange({ ...value, date_from: e.target.value })} />
      <span>→</span>
      <DateInput className={inputCls + " !w-36 !py-1"} value={value.date_to}
        onChange={(e) => onChange({ ...value, date_to: e.target.value })} />
    </div>
  );
}

// Cột "Người thực hiện" (K-16) — bản ghi trước khi có cột này hiện "—"
export const byColumn = { key: "created_by_name", label: "Người thực hiện", filter: "select", tdClass: "text-slate-500 text-xs", render: (t) => t.created_by_name || "—" };
