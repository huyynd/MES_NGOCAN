import toast from 'react-hot-toast';

export { toast };

// src/ui.js — helper dùng chung cho các module
export const inputCls =
  "w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-800 " +
  "placeholder:text-slate-400 disabled:placeholder-transparent " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition";

// C-08: không phải số (NaN, Infinity, "abc") → "—" thay vì "NaN"
// Số thập phân kiểu VN, cố định d chữ số lẻ (12,5 — thay cho x.toFixed(1) ra "12.5")
export const fmtDec = (n, d = 1) => { const x = Number(n); return Number.isFinite(x) ? x.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; };
export const fmt = (n) => { if (n == null || n === "") return "—"; const x = Number(n); return Number.isFinite(x) ? x.toLocaleString("vi-VN") : "—"; };

// Parse ISO date string trực tiếp để tránh lệch múi giờ và phụ thuộc locale browser
export const fmtDate = (d) => {
  if (!d) return "—";
  const s = String(d).slice(0, 10); // lấy phần "yyyy-MM-dd"
  const parts = s.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`; // dd/MM/yyyy
  return s;
};

// Ngày "yyyy-MM-dd" theo GIỜ MÁY (VN, UTC+7). KHÔNG dùng `date.toISOString().slice(0,10)` — đó là ngày UTC:
// 00:00–07:00 sáng sẽ ra ngày HÔM TRƯỚC, và new Date(y, m, 1) ra ngày cuối tháng trước.
export const ymd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayYmd = () => ymd(new Date());
export const monthStartYmd = () => { const n = new Date(); return ymd(new Date(n.getFullYear(), n.getMonth(), 1)); };

export const fmtDateTime = (d) => {
  if (!d) return "—";
  // Thời điểm có múi giờ (Date, hoặc ISO kèm "Z" / "+07:00" — vd created_at từ API là UTC) → đổi sang GIỜ MÁY (VN).
  // Trước đây cắt chuỗi thẳng → hiện giờ UTC, lệch 7 tiếng.
  if (d instanceof Date || /T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(String(d))) {
    const t = d instanceof Date ? d : new Date(d);
    if (!Number.isNaN(t.getTime())) {
      const p = (n) => String(n).padStart(2, "0");
      return `${p(t.getDate())}/${p(t.getMonth() + 1)}/${t.getFullYear()} ${p(t.getHours())}:${p(t.getMinutes())}`;
    }
  }
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

// Badge trạng thái dùng chung — 5 màu theo NGHĨA (chủ dự án chốt 2026-10-21). Trạng thái mới → xếp vào 1 trong 5 nhóm.
const BADGE = {
  gray : "bg-slate-100 text-slate-600", // xám — chờ / nháp
  blue : "bg-blue-50 text-blue-700", // xanh dương — đang làm / đã lên kế hoạch
  amber: "bg-amber-50 text-amber-700", // vàng — cần chú ý / 1 phần
  green: "bg-emerald-50 text-emerald-700", // xanh lá — xong / đã thanh toán
  red  : "bg-rose-50 text-rose-700", // đỏ — hủy / ngừng
};
const STATUS_COLORS = {
  // xám — chờ / nháp
  "Chờ duyệt": BADGE.gray,
  "Chờ sản xuất": BADGE.gray,
  "Bản nháp": BADGE.gray,
  "Chờ cân": BADGE.gray,
  // xanh dương — đang làm / đã lên kế hoạch
  "Mới": BADGE.blue,
  "Đã lên kế hoạch": BADGE.blue,
  "Đang sản xuất": BADGE.blue,
  "Đang tái chế": BADGE.blue,
  "Đang vận chuyển": BADGE.blue,
  "Đã xuất hóa đơn": BADGE.blue,
  // vàng — cần chú ý / 1 phần
  "Chờ nguyên vật liệu": BADGE.amber,
  "Bảo trì": BADGE.amber,
  "Chuyển hàng 1 phần": BADGE.amber,
  "Đã vận chuyển, chưa thanh toán": BADGE.amber,
  "Chờ thanh toán": BADGE.amber,
  "Đã thanh toán 1 phần": BADGE.amber,
  // xanh lá — xong / đã thanh toán
  "Hoàn thành": BADGE.green,
  "Hoàn thành sản xuất": BADGE.green,
  "Giao hàng": BADGE.green,
  "Đã thanh toán": BADGE.green,
  "Hoạt động": BADGE.green,
  // đỏ — hủy / ngừng
  "Đã hủy": BADGE.red,
  "Ngừng": BADGE.red,
  "Không hoạt động": BADGE.red,
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
