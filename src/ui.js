import toast from 'react-hot-toast';

export { toast };

// src/ui.js — helper dùng chung cho các module
export const inputCls =
  "w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 " +
  "placeholder:text-slate-400 disabled:placeholder-transparent " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition";

export const fmt = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("vi-VN"));

// Parse ISO date string trực tiếp để tránh lệch múi giờ và phụ thuộc locale browser
export const fmtDate = (d) => {
  if (!d) return "—";
  const s = String(d).slice(0, 10); // lấy phần "yyyy-MM-dd"
  const parts = s.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`; // dd/MM/yyyy
  return s;
};

export const fmtDateTime = (d) => {
  if (!d) return "—";
  const s = String(d);
  const date = s.slice(0, 10).split('-');
  const time = s.slice(11, 16); // HH:mm
  if (date.length === 3) {
    const dd = `${date[2]}/${date[1]}/${date[0]}`;
    return time ? `${dd} ${time}` : dd;
  }
  return s;
};

// Danh mục đơn vị tính dùng chung (chọn từ dropdown, không nhập tự do)
export const UNITS = ["Kg", "Cái", "Chiếc", "Dem", "Gram", "Cuộn", "Thùng", "Cm"];

// Badge trạng thái dùng chung (map màu theo trạng thái lệnh SX / đơn hàng)
const STATUS_COLORS = {
  "Chờ duyệt": "bg-slate-100 text-slate-600",
  "Đã lên kế hoạch": "bg-blue-50 text-blue-700",
  "Chờ nguyên vật liệu": "bg-purple-50 text-purple-700",
  "Đang sản xuất": "bg-amber-50 text-amber-700",
  "Hoàn thành": "bg-emerald-50 text-emerald-700",
  "Đã hủy": "bg-rose-50 text-rose-700",
  "Hoạt động": "bg-emerald-50 text-emerald-700",
  "Không hoạt động": "bg-rose-50 text-rose-700",
  "Bảo trì": "bg-amber-50 text-amber-700",
  "Ngừng": "bg-rose-50 text-rose-700",
  // Trạng thái sản xuất của máy (suy ra động)
  "Chờ sản xuất": "bg-slate-100 text-slate-600",
  "Mới": "bg-blue-50 text-blue-700",
  // Trạng thái đơn hàng (vòng đời SX → giao → thanh toán)
  "Hoàn thành sản xuất": "bg-teal-50 text-teal-700",
  "Chuyển hàng 1 phần": "bg-amber-50 text-amber-700",
  "Đang vận chuyển": "bg-indigo-50 text-indigo-700",
  "Đã vận chuyển, chưa thanh toán": "bg-orange-50 text-orange-700",
  "Đã thanh toán": "bg-cyan-50 text-cyan-700",
  // Phiếu giao hàng & thanh toán
  "Bản nháp": "bg-slate-100 text-slate-600",
  "Giao hàng": "bg-emerald-50 text-emerald-700",
  "Đã xuất hóa đơn": "bg-blue-50 text-blue-700",
  "Chờ thanh toán": "bg-amber-50 text-amber-700",
  "Đã thanh toán 1 phần": "bg-orange-50 text-orange-700",
};

export function statusClass(status) {
  return STATUS_COLORS[status] || "bg-slate-100 text-slate-600";
}

// Số ngày còn lại tới hạn giao (âm = đã trễ)
export const daysToDue = (due) => {
  if (!due) return null;
  const d = new Date(String(due).slice(0, 10) + "T00:00:00");
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
};

// Cảnh báo 3 màu theo hạn giao: đỏ ≤2 ngày (hoặc trễ) · vàng 3–5 ngày · xanh >5 ngày
export const dueTone = (due) => {
  const n = daysToDue(due);
  if (n === null) return { n: null, dot: "bg-slate-300", text: "text-slate-500", soft: "bg-slate-50 text-slate-500", label: "—" };
  if (n < 0)   return { n, dot: "bg-rose-600",    text: "text-rose-700",    soft: "bg-rose-50 text-rose-700",       label: `Trễ ${-n} ngày` };
  if (n <= 2)  return { n, dot: "bg-rose-500",    text: "text-rose-600",    soft: "bg-rose-50 text-rose-600",       label: n === 0 ? "Hạn hôm nay" : `Còn ${n} ngày` };
  if (n <= 5)  return { n, dot: "bg-amber-400",   text: "text-amber-600",   soft: "bg-amber-50 text-amber-700",     label: `Còn ${n} ngày` };
  return        { n, dot: "bg-emerald-500", text: "text-emerald-600", soft: "bg-emerald-50 text-emerald-700", label: `Còn ${n} ngày` };
};
