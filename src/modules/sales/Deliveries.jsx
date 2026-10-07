import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, Plus, Trash2, Pencil, ArrowLeft, Save, Printer, FileText, Truck } from "lucide-react";
import { deliveries as api, resource, deliverableOrders, inventory } from "../../mesApi.js";

const ordersApi = resource("sales-orders");
import { usePerm } from "../../perm.jsx";
import {  inputCls, fmt, fmtDate, statusClass , toast } from "../../ui.js";
import { specShort } from "../../specs.js";
import { PageHeader, Section, ListHeader, DataTable, Logo, UnitSelect, SearchSelect } from "../../components.jsx";

// Bảng chuyển trạng thái (khớp backend). "Giao hàng" chỉ đặt qua nút Giao hàng (trừ tồn).
// Bản nháp chỉ được Hủy; sau khi đã giao không cho Hủy (chưa có luồng hoàn kho).
const DN_TRANSITIONS = {
  "Bản nháp":             ["Đã hủy"],
  "Giao hàng":            ["Đã xuất hóa đơn", "Chờ thanh toán", "Đã thanh toán 1 phần", "Đã thanh toán"],
  "Đã xuất hóa đơn":      ["Chờ thanh toán", "Đã thanh toán 1 phần", "Đã thanh toán"],
  "Chờ thanh toán":       ["Đã xuất hóa đơn", "Đã thanh toán 1 phần", "Đã thanh toán"],
  "Đã thanh toán 1 phần": ["Chờ thanh toán", "Đã thanh toán"],
  "Đã thanh toán":        [],
  "Đã hủy":               [],
};
const today = () => new Date().toISOString().slice(0, 10);

// Thông tin đơn vị bán hàng (in trên phiếu xuất kho)
const COMPANY = {
  name: "CÔNG TY TNHH THƯƠNG MẠI SẢN XUẤT XNK BAO BÌ NGỌC AN THƯ",
  tax: "0316748578",
  address: "119/1 Đường Đỗ Mười, Tổ 4, Khu phố 1, Phường Thới An, Thành Phố Hồ Chí Minh",
  phone: "0938 446 156",
};
const MIN_ROWS = 8; // số dòng tối thiểu của bảng (in giấy cho đẹp)

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label} {required && <span className="text-rose-500">*</span>}</label>
    {children}
  </div>
);

/* ---- Form phiếu giao hàng & thanh toán ---- */
function DeliveryForm({ lookups, editId, initialOrderId, onBack, onSaved, onPrint }) {
  const { can, fpermSecret } = usePerm();
  const moneyPerm = fpermSecret("deliveries", "amounts");
  const showMoney = moneyPerm !== "hidden";
  const moneyEdit = moneyPerm === "edit";
  const [editing, setEditing] = useState(!editId);
  const [f, setF] = useState({ sales_order_id: "", customer_id: "", delivery_date: today(), status: "Bản nháp", note: "", paid_amount: "" });
  const [items, setItems] = useState([]);
  const [seq, setSeq] = useState(2);
  const [orderList, setOrderList] = useState([]); // đơn GIAO ĐƯỢC của khách đã chọn
  const [stock, setStock] = useState([]);         // tồn kho để bán lẻ (không theo đơn)
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const manual = !f.sales_order_id;               // bán hàng tồn kho (không gắn đơn)
  useEffect(() => { inventory.list().then(setStock).catch(() => {}); }, []);
  // Gộp tồn theo sản phẩm (cả NVL/BTP/TP, bỏ Phế liệu) cho picker + hiển thị tồn
  const stockByProduct = React.useMemo(() => {
    const m = new Map();
    stock.filter((s) => ["NVL", "BTP", "TP"].includes(s.warehouse_type) && Number(s.quantity) > 0).forEach((s) => {
      const cur = m.get(s.product_id) || { product_id: s.product_id, product_name: s.product_name, unit: s.unit, qty: 0, wh: new Set() };
      cur.qty += Number(s.quantity) || 0; cur.wh.add(s.warehouse_type); if (!cur.unit) cur.unit = s.unit;
      m.set(s.product_id, cur);
    });
    return m;
  }, [stock]);
  const stockOptions = [...stockByProduct.values()].map((s) => ({ value: s.product_id, label: `${s.product_name} · tồn ${fmt(s.qty)} ${s.unit || ""} (${[...s.wh].join("/")})` }));
  const addStockRow = (pid) => {
    if (!pid) return;
    if (items.some((x) => x.product_id === pid)) { toast.error("Sản phẩm đã có trong phiếu"); return; }
    const s = stockByProduct.get(pid); if (!s) return;
    setItems((a) => [...a, { _k: seq, product_id: pid, product_name: s.product_name, unit: s.unit, specs: {}, unit_price: "", quantity: "" }]);
    setSeq((n) => n + 1);
  };

  const load = useCallback(() => {
    if (!editId) return;
    api.get(editId).then(async (d) => {
      setF({ sales_order_id: d.sales_order_id || "", customer_id: d.customer_id, delivery_date: d.delivery_date?.slice(0, 10) || today(), status: d.status, note: d.note || "", paid_amount: d.paid_amount ?? "" });
      if (d.customer_id) deliverableOrders(d.customer_id).then(setOrderList).catch(() => {});
      // Làm giàu dòng từ đơn (SL đặt/đã SX/đã giao) rồi gộp SL giao đã lưu
      const emap = {};
      if (d.sales_order_id) { try { const od = await api.fromOrder(d.sales_order_id); (od.items || []).forEach((x) => { emap[x.sales_order_item_id] = x; }); } catch { /* ignore */ } }
      setItems((d.items || []).map((it, i) => {
        const e = emap[it.sales_order_item_id] || {};
        return { _k: i + 1, sales_order_item_id: it.sales_order_item_id || "", product_id: it.product_id || "", product_name: it.product_name || e.product_name || "", specs: it.specs || e.specs || {}, unit: it.unit || e.unit || "", unit_price: it.unit_price ?? e.unit_price ?? "", quantity: it.quantity, ordered: e.ordered ?? "", produced: e.produced ?? "", delivered: e.delivered ?? "" };
      }));
      setSeq((d.items?.length || 0) + 1);
    }).catch((e) => toast.error("Lỗi tải phiếu: " + e.message));
  }, [editId]);
  useEffect(() => { load(); }, [load]);
  // Mở từ chi tiết đơn hàng → tự nạp sẵn (nạp cả danh sách đơn của khách)
  useEffect(() => { if (!editId && initialOrderId) onPickOrder(initialOrderId); }, [initialOrderId]); // eslint-disable-line

  // B1: chọn Khách hàng → nạp danh sách đơn GIAO ĐƯỢC, reset đơn + dòng hàng
  const onCustomer = async (cid) => {
    setF((s) => ({ ...s, customer_id: cid, sales_order_id: "" }));
    setItems([]); setOrderList([]);
    if (!cid) return;
    try { setOrderList(await deliverableOrders(cid)); } catch (e) { toast.error("Lỗi tải đơn của khách: " + e.message); }
  };

  // B2+B3: chọn Đơn → đổ dòng hàng kèm SL đặt/đã SX/đã giao/còn lại; SL giao mặc định = còn lại
  const onPickOrder = async (orderId) => {
    set("sales_order_id", orderId);
    if (!orderId) { setItems([]); return; }
    try {
      const d = await api.fromOrder(orderId);
      if (!orderList.length && d.customer_id) deliverableOrders(d.customer_id).then(setOrderList).catch(() => {});
      setF((s) => ({ ...s, sales_order_id: d.sales_order_id, customer_id: d.customer_id || s.customer_id }));
      setItems((d.items || []).map((it, i) => ({
        _k: i + 1, sales_order_item_id: it.sales_order_item_id, product_id: it.product_id || "", product_name: it.product_name || "",
        specs: it.specs || {}, unit: it.unit || "", unit_price: it.unit_price || "",
        ordered: it.ordered, produced: it.produced, delivered: it.delivered,
        quantity: Number(it.remaining) > 0 ? it.remaining : "",   // SL giao mặc định = còn lại
      })));
      setSeq((d.items?.length || 0) + 1);
    } catch (e) { toast.error("Lỗi nạp đơn hàng: " + e.message); }
  };

  const rmItem = (k) => setItems((a) => a.filter((x) => x._k !== k));
  const upItem = (k, fld, v) => setItems((a) => a.map((x) => (x._k === k ? { ...x, [fld]: v } : x)));

  const total = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const debt = total - (Number(f.paid_amount) || 0);

  const save = async () => {
    if (!f.customer_id) return toast.error("Chọn khách hàng");
    const valid = items.filter((it) => (it.product_id || it.product_name) && Number(it.quantity) > 0);
    if (!valid.length) return toast.error("Cần ít nhất 1 dòng có SL giao > 0");
    // Cảnh báo (không chặn) nếu giao DƯ so với số còn lại — chỉ khi gắn đơn hàng
    if (f.sales_order_id) {
      const over = valid.filter((it) => Number(it.quantity) > (Number(it.ordered) || 0) - (Number(it.delivered) || 0) + 1e-6);
      if (over.length && !confirm(`Có ${over.length} dòng giao DƯ so với số còn lại của đơn (${over.map((x) => `${x.product_name}: giao ${fmt(Number(x.quantity))} / còn ${fmt((Number(x.ordered) || 0) - (Number(x.delivered) || 0))}`).join("; ")}).\nSản xuất dư là bình thường — vẫn cho giao. Tiếp tục lưu?`)) return;
    }
    try {
      if (editId) {
        await api.update(editId, { ...f, items: valid });
        toast.success("Đã lưu thành công");
        setEditing(false); load(); // ở lại màn chi tiết
      } else {
        await api.create({ ...f, items: valid });
        toast.success("Đã lưu thành công"); onSaved(); // tạo mới → về list
      }
    } catch (e) { toast.error("Lỗi lưu phiếu: " + e.message); }
  };
  const del = async () => { if (!confirm("Xóa phiếu này?")) return; try { await api.remove(editId); toast.success("Đã xóa thành công"); onSaved(); } catch (e) { toast.error("Lỗi xóa: " + e.message); } };
  const ship = async () => {
    if (!confirm("Xác nhận GIAO HÀNG cho khách?\nHệ thống sẽ tạo phiếu xuất kho (Giao hàng cho khách) và TRỪ TỒN Kho Thành phẩm theo số lượng giao.")) return;
    try { const r = await api.ship(editId); toast.success(r?.message || "Đã giao hàng"); load(); }
    catch (e) { toast.error("Không giao được: " + e.message); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={!editId ? "Tạo phiếu giao hàng" : editing ? "Sửa phiếu giao hàng" : "Chi tiết phiếu giao hàng"} onBack={onBack}
        actions={editId && !editing ? (<>
          {f.status === "Bản nháp" && can("deliveries", "approve") &&
            <button onClick={ship} className="btn-primary"><Truck size={16} /> Giao hàng</button>}
          <button onClick={() => onPrint?.(editId)} className="btn-ghost"><Printer size={16} /> In phiếu</button>
          {can("deliveries", "edit") && <button onClick={() => setEditing(true)} className="btn-ghost"><Pencil size={16} /> Sửa</button>}
          {can("deliveries", "delete") && <button onClick={del} className="btn-ghost" style={{ color: "#e11d48" }}><Trash2 size={16} /> Xóa</button>}
        </>) : (<>
          {editId && <button onClick={() => { setEditing(false); load(); }} className="btn-ghost">Hủy</button>}
          <button onClick={save} className="btn-primary"><Save size={16} /> Lưu phiếu</button>
        </>)} />

      <fieldset disabled={!editing} className="space-y-5">
        <Section title="Thông tin phiếu">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            <Field label="Khách hàng" required>
              <SearchSelect
                value={f.customer_id}
                onChange={onCustomer}
                options={lookups.customers.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="-- Chọn khách hàng --"
              />
            </Field>
            <Field label="Đơn hàng (tùy chọn)">
              <SearchSelect
                value={f.sales_order_id}
                onChange={onPickOrder}
                disabled={!f.customer_id}
                options={[{ value: "", label: "— Không theo đơn (bán hàng tồn kho) —" }, ...orderList.map((o) => ({ value: o.id, label: `${o.order_code} · ${o.status} · còn ${fmt(o.remaining_total)}` }))]}
                placeholder={!f.customer_id ? "Chọn khách hàng trước" : (orderList.length ? "-- Chọn đơn hàng --" : "Không theo đơn — chọn hàng trong kho bên dưới")}
              />
            </Field>
            <Field label="Trạng thái">
              <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option value={f.status}>{f.status}{["Bản nháp", "Giao hàng"].includes(f.status) ? " (hệ thống)" : ""}</option>
                {(DN_TRANSITIONS[f.status] || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Ngày giao"><input type="date" className={inputCls} value={f.delivery_date} onChange={(e) => set("delivery_date", e.target.value)} /></Field>
            <Field label="Ghi chú"><input className={inputCls} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
            {showMoney && <Field label="Tổng tiền 1 đơn">
              <div className={inputCls + " bg-slate-50 font-semibold text-slate-800"}>{fmt(total)} đ</div>
            </Field>}
            {showMoney && <Field label="Số tiền đã trả">
              <input type="number" min="0" className={inputCls} disabled={!moneyEdit} value={f.paid_amount} placeholder="0" onChange={(e) => set("paid_amount", e.target.value)} />
            </Field>}
            {showMoney && <Field label="Công nợ (còn lại)">
              <div className={inputCls + " bg-slate-50 font-bold " + (debt > 0 ? "text-rose-600" : "text-emerald-600")}>{fmt(debt)} đ</div>
            </Field>}
          </div>
        </Section>

        <Section title={manual ? "Dòng hàng (bán tồn kho — không theo đơn)" : "Dòng hàng (theo đơn)"} bodyClass="p-0">
         {manual ? (
          <>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Sản phẩm</th>
                <th className="text-left px-3 py-2.5 w-28" title="Kho đang có tồn">Kho</th>
                <th className="text-right px-3 py-2.5 w-28" title="Tồn kho hiện có">Tồn kho</th>
                <th className="text-right px-3 py-2.5 w-28 bg-blue-50/60 text-blue-700" title="SL giao ở phiếu này">SL giao</th>
                <th className="text-left px-3 py-2.5 w-16">ĐVT</th>
                {showMoney && <th className="text-right px-4 py-2.5 w-28">Đơn giá</th>}
                {showMoney && <th className="text-right px-4 py-2.5 w-32">Thành tiền</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => {
                const s = stockByProduct.get(it.product_id);
                const onHand = s ? s.qty : 0, giao = Number(it.quantity) || 0;
                const over = giao > onHand + 1e-6;
                const amount = giao * (Number(it.unit_price) || 0);
                return (
                  <tr key={it._k}>
                    <td className="px-4 py-1.5 font-medium text-slate-800">{it.product_name || "—"}</td>
                    <td className="px-3 py-1.5 text-slate-500">{s ? [...s.wh].join("/") : "—"}</td>
                    <td className="px-3 py-1.5 text-right text-slate-600">{fmt(onHand)}</td>
                    <td className="px-3 py-1.5 bg-blue-50/40">
                      <input type="number" min="0" className={inputCls + " text-right font-semibold text-blue-700" + (over ? " !border-amber-400 !ring-2 !ring-amber-200" : "")}
                        value={it.quantity ?? ""} onChange={(e) => upItem(it._k, "quantity", e.target.value)}
                        title={over ? `Giao ${fmt(giao)} vượt tồn ${fmt(onHand)} — không đủ tồn sẽ không giao được` : undefined} />
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{it.unit || "—"}</td>
                    {showMoney && <td className="px-4 py-1.5"><input type="number" min="0" className={inputCls + " text-right"} disabled={!moneyEdit} value={it.unit_price} onChange={(e) => upItem(it._k, "unit_price", e.target.value)} /></td>}
                    {showMoney && <td className="px-4 py-1.5 text-right font-semibold text-slate-800">{fmt(amount)}</td>}
                    <td className="px-2 py-1.5 text-center">{editing && <button type="button" onClick={() => rmItem(it._k)} className="text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>}</td>
                  </tr>
                );
              })}
              {!items.length && <tr><td colSpan={showMoney ? 8 : 6} className="px-4 py-8 text-center text-slate-400">Chọn sản phẩm trong kho bên dưới để thêm dòng giao.</td></tr>}
            </tbody>
            {showMoney && !!items.length && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-bold text-slate-800">
                  <td colSpan={6} className="px-4 py-3 text-right">TỔNG TIỀN</td>
                  <td className="px-4 py-3 text-right text-blue-700 text-base">{fmt(total)} đ</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          {editing && (
            <div className="p-3 border-t border-slate-100 bg-slate-50/40 flex items-center gap-2">
              <span className="text-sm text-slate-500 shrink-0">Thêm sản phẩm từ kho:</span>
              <div className="w-96 max-w-full"><SearchSelect value="" onChange={addStockRow} options={stockOptions} placeholder="-- Chọn sản phẩm trong kho (NVL/BTP/TP) --" /></div>
            </div>
          )}
          </>
         ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Sản phẩm</th>
                <th className="text-left px-4 py-2.5">Thông số</th>
                <th className="text-right px-3 py-2.5 w-24" title="SL khách đặt mua">SL đặt</th>
                <th className="text-right px-3 py-2.5 w-24" title="SL đã nhập kho thành phẩm">SL đã SX</th>
                <th className="text-right px-3 py-2.5 w-24" title="SL đã giao các phiếu trước">SL đã giao</th>
                <th className="text-right px-3 py-2.5 w-28 bg-blue-50/60 text-blue-700" title="SL giao ở phiếu này">SL giao</th>
                <th className="text-right px-3 py-2.5 w-24" title="Còn lại sau khi giao">SL còn lại</th>
                <th className="text-left px-3 py-2.5 w-16">ĐVT</th>
                {showMoney && <th className="text-right px-4 py-2.5 w-28">Đơn giá</th>}
                {showMoney && <th className="text-right px-4 py-2.5 w-32">Thành tiền</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => {
                const ordered = Number(it.ordered) || 0, delivered = Number(it.delivered) || 0, giao = Number(it.quantity) || 0;
                const conLai = ordered - delivered - giao;      // còn lại sau khi giao phiếu này
                const over = giao > (ordered - delivered) + 1e-6; // giao dư hơn còn lại
                const amount = giao * (Number(it.unit_price) || 0);
                return (
                  <tr key={it._k}>
                    <td className="px-4 py-1.5 font-medium text-slate-800">{it.product_name || "—"}</td>
                    <td className="px-4 py-1.5 text-slate-500">{specShort(it.specs) || "—"}</td>
                    <td className="px-3 py-1.5 text-right text-slate-600">{fmt(ordered)}</td>
                    <td className="px-3 py-1.5 text-right text-slate-600">{fmt(it.produced)}</td>
                    <td className="px-3 py-1.5 text-right text-slate-600">{fmt(delivered)}</td>
                    <td className="px-3 py-1.5 bg-blue-50/40">
                      <input type="number" min="0" className={inputCls + " text-right font-semibold text-blue-700" + (over ? " !border-amber-400 !ring-2 !ring-amber-200" : "")}
                        value={it.quantity ?? ""} onChange={(e) => upItem(it._k, "quantity", e.target.value)}
                        title={over ? `Giao dư ${fmt(giao - (ordered - delivered))} so với còn lại — vẫn cho giao` : undefined} />
                    </td>
                    <td className={"px-3 py-1.5 text-right font-medium " + (conLai < -1e-6 ? "text-amber-600" : conLai < 1e-6 ? "text-emerald-600" : "text-slate-700")}>
                      {fmt(conLai)}{conLai < -1e-6 ? " (dư)" : ""}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{it.unit || "—"}</td>
                    {showMoney && <td className="px-4 py-1.5"><input type="number" min="0" className={inputCls + " text-right"} disabled={!moneyEdit} value={it.unit_price} onChange={(e) => upItem(it._k, "unit_price", e.target.value)} /></td>}
                    {showMoney && <td className="px-4 py-1.5 text-right font-semibold text-slate-800">{fmt(amount)}</td>}
                  </tr>
                );
              })}
              {!items.length && <tr><td colSpan={showMoney ? 10 : 8} className="px-4 py-8 text-center text-slate-400">Chọn Khách hàng rồi chọn Đơn hàng để nạp dòng giao.</td></tr>}
            </tbody>
            {showMoney && !!items.length && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-bold text-slate-800">
                  <td colSpan={9} className="px-4 py-3 text-right">TỔNG TIỀN</td>
                  <td className="px-4 py-3 text-right text-blue-700 text-base">{fmt(total)} đ</td>
                </tr>
              </tfoot>
            )}
          </table>
         )}
        </Section>
      </fieldset>
    </div>
  );
}

/* ---- Phiếu in (template chung giao hàng + thanh toán) ---- */
function DeliveryVoucher({ id, onBack }) {
  const { fpermSecret } = usePerm();
  const showMoney = fpermSecret("deliveries", "amounts") !== "hidden";
  const [d, setD] = useState(null);
  useEffect(() => { api.get(id).then(setD).catch((e) => toast.error("Lỗi: " + e.message)); }, [id]);
  if (!d) return <div className="text-slate-400 text-sm py-10">Đang tải phiếu…</div>;
  const totalQty = (d.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
  const dt = d.delivery_date ? new Date(d.delivery_date) : null;
  const items = d.items || [];
  // padding cho đủ số dòng tối thiểu (in giấy)
  const rows = [...items, ...Array(Math.max(0, MIN_ROWS - items.length)).fill(null)];

  const td = "border border-slate-400 px-2 py-1.5 align-top";
  const th = "border border-slate-400 px-2 py-1.5 text-center font-bold";
  const cols = showMoney ? 7 : 5; // STT,NỘI DUNG,ĐVT,SL,(ĐƠN GIÁ,THÀNH TIỀN),GHI CHÚ

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between no-print">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm"><ArrowLeft size={18} /> Quay lại</button>
        <button onClick={() => window.print()} className="btn-primary"><Printer size={16} /> In / Xuất PDF</button>
      </div>

      <div className="print-area bg-white rounded-xl border border-slate-200 p-8 max-w-3xl mx-auto text-slate-900">
        {/* Header: logo + tiêu đề */}
        <div className="flex items-center gap-4 border-b-2 border-blue-700 pb-3">
          <Logo className="h-14 w-auto shrink-0" />
          <div className="flex-1 text-center">
            <h1 className="text-2xl font-extrabold text-blue-800 tracking-wide uppercase">Phiếu xuất kho</h1>
            <div className="text-sm mt-0.5">
              Ngày {dt ? dt.getDate() : "...."} tháng {dt ? dt.getMonth() + 1 : "...."} năm {dt ? dt.getFullYear() : "20...."}
            </div>
            <div className="text-sm">Số phiếu: <b className="text-rose-600">{d.note_code}</b></div>
          </div>
          <div className="w-12 shrink-0" />
        </div>

        {/* Đơn vị bán hàng */}
        <div className="text-sm mt-3 leading-relaxed">
          <div><b>Đơn vị bán hàng:</b> {COMPANY.name}</div>
          <div><b>Mã số thuế:</b> {COMPANY.tax}</div>
          <div><b>Địa chỉ:</b> {COMPANY.address}</div>
          <div><b>Số điện thoại:</b> {COMPANY.phone}</div>
        </div>

        {/* Người mua hàng */}
        <div className="text-sm mt-2 leading-relaxed border-t border-slate-300 pt-2">
          <div><b>Người mua hàng:</b> {d.customer_name || ""}</div>
          <div><b>Tên đơn vị:</b> {d.customer_name || ""}</div>
          <div><b>Địa chỉ:</b> {d.customer_address || ""}</div>
          <div><b>Số điện thoại:</b> {d.customer_phone || ""}</div>
        </div>

        {/* Bảng hàng */}
        <table className="w-full text-sm border-collapse mt-3">
          <thead className="bg-blue-50">
            <tr>
              <th className={th + " w-10"}>STT</th>
              <th className={th}>NỘI DUNG</th>
              <th className={th + " w-16"}>ĐVT</th>
              <th className={th + " w-20"}>SL</th>
              {showMoney && <th className={th + " w-24"}>ĐƠN GIÁ</th>}
              {showMoney && <th className={th + " w-28"}>THÀNH TIỀN</th>}
              <th className={th + " w-28"}>GHI CHÚ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={i} style={{ height: 30 }}>
                <td className={td + " text-center"}>{it ? i + 1 : ""}</td>
                <td className={td}>{it ? <><span className="font-medium">{it.product_name}</span>{specShort(it.specs) ? <span className="text-slate-500"> · {specShort(it.specs)}</span> : null}</> : ""}</td>
                <td className={td + " text-center"}>{it ? it.unit : ""}</td>
                <td className={td + " text-right"}>{it ? (it.actual_quantity !== null && it.actual_quantity !== undefined && it.actual_quantity !== "" ? fmt(it.actual_quantity) : fmt(it.quantity)) : ""}</td>
                {showMoney && <td className={td + " text-right"}>{it ? fmt(it.unit_price) : ""}</td>}
                {showMoney && <td className={td + " text-right"}>{it ? fmt(it.amount) : ""}</td>}
                <td className={td}>{it ? (it.note || "") : ""}</td>
              </tr>
            ))}
            <tr className="font-bold bg-blue-50">
              <td className={td + " text-center"} colSpan={3}>TỔNG CỘNG</td>
              <td className={td + " text-right"}>{fmt(totalQty)}</td>
              {showMoney && <td className={td} />}
              {showMoney && <td className={td + " text-right text-blue-800"}>{fmt(d.total_amount)} đ</td>}
              <td className={td} />
            </tr>
          </tbody>
        </table>

        {/* Tổng tiền / công nợ (chỉ khi có quyền tiền) */}
        {showMoney && (Number(d.paid_amount) > 0 || Number(d.total_amount) - Number(d.paid_amount) !== 0) && (
          <div className="flex justify-end mt-2 text-sm">
            <table>
              <tbody>
                <tr><td className="px-3 py-0.5 text-right text-slate-600">Đã trả:</td><td className="px-3 py-0.5 text-right font-semibold text-emerald-700">{fmt(d.paid_amount)} đ</td></tr>
                <tr><td className="px-3 py-0.5 text-right font-bold">Còn nợ:</td><td className={`px-3 py-0.5 text-right font-bold ${Number(d.total_amount) - Number(d.paid_amount) > 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(Number(d.total_amount) - Number(d.paid_amount))} đ</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Chữ ký */}
        <div className="grid grid-cols-4 gap-2 mt-8 text-center text-sm">
          {["Người lập phiếu", "Người giao hàng", "Kế toán", "Người nhận hàng"].map((s) => (
            <div key={s}><div className="font-semibold">{s}</div><div className="text-slate-400 text-[11px]">(Ký, ghi rõ họ tên)</div><div className="h-12" /></div>
          ))}
        </div>

        <div className="text-center font-bold text-sm mt-4 border-t border-slate-300 pt-2 uppercase">
          K.H vui lòng kiểm tra hàng hóa trước khi ký nhận
        </div>
      </div>

      <style>{`@media print {
        body * { visibility: hidden !important; }
        .print-area, .print-area * { visibility: visible !important; }
        .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none !important; padding: 0 !important; }
        .no-print { display: none !important; }
        @page { size: A4; margin: 12mm; }
      }`}</style>
    </div>
  );
}

/* ---- Module chính ---- */
export default function DeliveriesModule({ lookups, focusOrderId, onFocusConsumed }) {
  const { can, fpermSecret } = usePerm();
  const showMoney = fpermSecret("deliveries", "amounts") !== "hidden";
  const [view, setView] = useState("list");
  const [editId, setEditId] = useState(null);
  const [newOrderId, setNewOrderId] = useState(null);
  const [voucherId, setVoucherId] = useState(null);
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    try { setRows((await api.list({})) || []); } catch (e) { toast.error("Lỗi tải phiếu: " + e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Điều hướng từ chi tiết đơn hàng → mở form tạo phiếu, nạp sẵn đơn
  useEffect(() => {
    if (focusOrderId) { setEditId(null); setNewOrderId(focusOrderId); setView("form"); onFocusConsumed?.(); }
  }, [focusOrderId]); // eslint-disable-line

  const del = async (id) => { if (!confirm("Xóa phiếu này?")) return; try { await api.remove(id); toast.success("Đã xóa thành công"); load(); } catch (e) { toast.error("Lỗi xóa: " + e.message); } };

  const resetToList = () => { setView("list"); setEditId(null); setNewOrderId(null); };
  if (view === "form") return <DeliveryForm lookups={lookups} editId={editId} initialOrderId={newOrderId}
    onBack={() => { resetToList(); load(); }} onSaved={() => { resetToList(); load(); }}
    onPrint={(id) => { setVoucherId(id); setView("voucher"); }} />;
  if (view === "voucher") return <DeliveryVoucher id={voucherId} onBack={() => setView("list")} />;

  const columns = [
    { key: "note_code", label: "Số phiếu", filter: "text", render: (r) => <button onClick={() => { setEditId(r.id); setView("form"); }} className="font-medium text-blue-600 hover:underline">{r.note_code}</button> },
    { key: "customer_name", label: "Khách hàng", filter: "select", tdClass: "text-slate-800" },
    { key: "sales_order_code", label: "Đơn hàng", filter: "text", render: (r) => r.sales_order_code || "—" },
    { key: "delivery_date", label: "Ngày giao", filter: "date", render: (r) => fmtDate(r.delivery_date) },
    { key: "item_count", label: "Số dòng", align: "center" },
    ...(showMoney ? [
      { key: "total_amount", label: "Tổng tiền", align: "right", render: (r) => <span className="font-semibold">{fmt(r.total_amount)} đ</span> },
      { key: "debt", label: "Công nợ", align: "right", render: (r) => { const dbt = Number(r.total_amount || 0) - Number(r.paid_amount || 0); return <span className={`font-semibold ${dbt > 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(dbt)} đ</span>; } },
    ] : []),
    { key: "status", label: "Trạng thái", filter: "select", render: (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span> },
    { key: "_act", label: "", align: "right", render: (r) => (<>
        <button onClick={() => { setVoucherId(r.id); setView("voucher"); }} title="In phiếu" className="text-slate-400 hover:text-emerald-600 p-1"><FileText size={15} /></button>
        <button onClick={() => { setEditId(r.id); setView("form"); }} title="Sửa" className="text-slate-400 hover:text-blue-600 p-1"><Pencil size={15} /></button>
        {can("deliveries", "delete") && <button onClick={() => del(r.id)} title="Xóa" className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={15} /></button>}
      </>) },
  ];

  return (
    <div className="space-y-5">
      <ListHeader title="Phiếu giao hàng & thanh toán" actions={<>
        <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        {can("deliveries", "create") && <button onClick={() => { setEditId(null); setView("form"); }} className="btn-primary"><Plus size={16} /> Tạo phiếu</button>}
      </>} />
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Chưa có phiếu giao hàng" />
    </div>
  );
}
