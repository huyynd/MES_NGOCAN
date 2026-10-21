import React, { useState, useEffect, useCallback } from "react";
import { Printer, Tag } from "lucide-react";
import { ListHeader } from "../../components.jsx";
import { production } from "../../mesApi.js";
import {  inputCls, fmt, fmtDate , toast } from "../../ui.js";

// Các thông tin có thể in lên tem (khách không có máy quét QR → in chữ to, rõ)
const PROD_FIELDS = [
  { key: "product", label: "Sản phẩm" },
  { key: "color", label: "Màu sắc" },
  { key: "size", label: "Kích thước" },
  { key: "thickness", label: "Độ dày" },
  { key: "qty", label: "Số lượng" },
  { key: "type", label: "Loại (TP/BTP)" },
  { key: "machine", label: "Máy" },
  { key: "date", label: "Ngày SX" },
  { key: "sales_order", label: "Mã đơn hàng" },
  { key: "po", label: "Mã lệnh SX" },
  { key: "task", label: "Mã lô" },
];
const CUST_FIELDS = [
  { key: "customer", label: "Khách hàng" },
  { key: "customer_phone", label: "Điện thoại" },
  { key: "customer_address", label: "Địa chỉ" },
];
const ALL_FIELDS = [...PROD_FIELDS, ...CUST_FIELDS];
const DEFAULT_ON = ["product", "color", "size", "thickness", "qty", "type", "date", "sales_order", "task", "customer", "customer_phone", "customer_address"];

// Cỡ chữ theo cỡ tem
const SIZE_CFG = {
  S: { w: 300, title: "text-base", value: "text-sm", label: "text-[11px]", head: "text-lg" },
  M: { w: 380, title: "text-lg", value: "text-base", label: "text-xs", head: "text-2xl" },
  L: { w: 480, title: "text-xl", value: "text-lg", label: "text-sm", head: "text-3xl" },
};

export default function QrLabelsModule() {
  const [orderList, setOrderList] = useState([]);
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [copies, setCopies] = useState(1);
  const [size, setSize] = useState("M");
  const [fields, setFields] = useState(Object.fromEntries(ALL_FIELDS.map((f) => [f.key, DEFAULT_ON.includes(f.key)])));

  useEffect(() => { production.list().then(setOrderList).catch((e) => toast.error("Không tải được danh sách lệnh SX — bấm Làm mới: " + e.message)); }, []);

  const load = useCallback(async (id) => {
    setOrderId(id);
    if (!id) { setOrder(null); setTasks([]); return; }
    try {
      const [o, t] = await Promise.all([production.get(id), production.getTasks(id)]);
      setOrder(o); setTasks(t);
    } catch (e) { toast.error("Lỗi tải lệnh: " + e.message); }
  }, []);

  const dataOf = (t) => ({
    sales_order: order.sales_order_code || "—",
    po: order.order_code,
    task: t.task_code,
    stage: t.stage,
    type: t.stage === "Cắt" ? "Thành phẩm" : "Bán thành phẩm",
    product: order.product_name,
    color: order.attr_color || "—",
    size: order.attr_size || "—",
    thickness: order.attr_thickness || "—",
    qty: `${fmt(t.quantity)} ${order.unit || ""}`.trim(),
    machine: t.machine_name || "—",
    date: fmtDate(t.planned_date),
    customer: order.customer_name || "—",
    customer_phone: order.customer_phone || "—",
    customer_address: order.customer_address || "—",
  });
  const on = (k) => fields[k];
  const toggle = (k) => setFields((s) => ({ ...s, [k]: !s[k] }));

  // mở rộng theo số bản in
  const labels = [];
  tasks.forEach((t) => { for (let i = 0; i < Math.max(1, copies); i++) labels.push(t); });
  const cfg = SIZE_CFG[size];

  const Row = ({ label, value }) => (
    <div className="flex gap-2 items-baseline">
      <span className={`${cfg.label} text-slate-500 shrink-0`}>{label}:</span>
      <span className={`${cfg.value} font-bold text-slate-900 break-words`}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      <ListHeader title="In tem truy xuất" />

      {/* Cấu hình */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 no-print">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Lệnh sản xuất</label>
            <select className={inputCls} value={orderId} onChange={(e) => load(e.target.value)}>
              <option value="">-- Chọn lệnh SX --</option>
              {orderList.map((o) => <option key={o.id} value={o.id}>{o.order_code} · {o.product_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Cỡ tem</label>
            <select className={inputCls} value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="S">Nhỏ</option><option value="M">Vừa</option><option value="L">Lớn</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Số bản in mỗi lô</label>
            <input type="number" min="1" className={inputCls} value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)} />
          </div>
        </div>
        <div>
          <div className="text-sm font-medium text-slate-600 mb-2">Thông tin in lên tem (tùy chọn)</div>
          <div className="flex flex-wrap gap-2">
            {ALL_FIELDS.map((f) => (
              <label key={f.key} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer text-sm transition ${
                fields[f.key] ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                <input type="checkbox" checked={fields[f.key]} onChange={() => toggle(f.key)} className="w-4 h-4 accent-blue-600" />
                {f.label}
              </label>
            ))}
          </div>
        </div>
        {order && tasks.length > 0 && (
          <div className="flex justify-end">
            <button onClick={() => window.print()} className="btn-primary"><Printer size={16} /> In tem ({labels.length})</button>
          </div>
        )}
      </div>

      {/* Khu tem */}
      {!order && <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 no-print">Chọn một lệnh sản xuất để tạo tem dán cho từng lô.</div>}
      {order && tasks.length === 0 && <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 no-print">Lệnh này chưa được chia lô (phân công). Vào <b>Sản xuất → mở lệnh → Phân công</b> trước.</div>}

      {order && tasks.length > 0 && (
        <div className="print-area flex flex-wrap gap-3">
          {labels.map((t, i) => {
            const d = dataOf(t);
            return (
              <div key={i} className="qr-label border-2 border-slate-800 rounded-lg bg-white overflow-hidden" style={{ width: cfg.w }}>
                {/* Đầu tem: công đoạn + mã lô (to, nổi bật) */}
                <div className="bg-blue-600 text-white px-4 py-2.5 flex items-center justify-between">
                  <span className={`${cfg.head} font-extrabold leading-none`}>{d.stage}</span>
                  {on("task") && <span className={`${cfg.title} font-bold`}>{d.task}</span>}
                </div>

                <div className="px-4 py-3 space-y-2">
                  {/* Sản phẩm nổi bật nhất */}
                  {on("product") && <div className={`${cfg.head} font-extrabold text-slate-900 leading-tight`}>{d.product}</div>}

                  {/* Thông số */}
                  {(on("color") || on("size") || on("thickness")) && (
                    <div className={`${cfg.value} font-bold text-slate-800`}>
                      {[on("color") && d.color, on("size") && d.size, on("thickness") && d.thickness].filter(Boolean).join("  ·  ")}
                    </div>
                  )}
                  {on("qty") && <div className={`${cfg.head} font-extrabold text-blue-700`}>SL: {d.qty}</div>}

                  <div className="space-y-0.5">
                    {on("type") && <Row label="Loại" value={d.type} />}
                    {on("machine") && <Row label="Máy" value={d.machine} />}
                    {on("date") && <Row label="Ngày SX" value={d.date} />}
                    {on("sales_order") && <Row label="Mã ĐH" value={d.sales_order} />}
                    {on("po") && <Row label="Mã LSX" value={d.po} />}
                  </div>

                  {/* Khối khách hàng */}
                  {(on("customer") || on("customer_phone") || on("customer_address")) && (
                    <div className="mt-2 pt-2 border-t-2 border-dashed border-slate-300">
                      {on("customer") && (
                        <div className="flex gap-2 items-baseline">
                          <span className={`${cfg.label} text-slate-500 shrink-0`}>Khách hàng:</span>
                          <span className={`${cfg.head} font-extrabold text-slate-900 break-words`}>{d.customer}</span>
                        </div>
                      )}
                      {on("customer_phone") && <Row label="Điện thoại" value={d.customer_phone} />}
                      {on("customer_address") && <Row label="Địa chỉ" value={d.customer_address} />}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@media print {
        body * { visibility: hidden !important; }
        .print-area, .print-area * { visibility: visible !important; }
        .print-area { position: absolute; left: 0; top: 0; }
        .no-print { display: none !important; }
        .qr-label { break-inside: avoid; }
      }`}</style>
    </div>
  );
}
