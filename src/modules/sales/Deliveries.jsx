import React, { useState, useEffect, useCallback } from "react";
import { useAppSettings } from "../../appSettings.js";
import { useNavigate } from "react-router-dom";
import { RotateCcw, Plus, Trash2, Pencil, ArrowLeft, Save, Printer, FileText, Truck, Wallet, X } from "lucide-react";
import { deliveries as api, resource, inventory, paymentReceipts } from "../../mesApi.js";
import { DebtBanner } from "./debtUi.jsx";

const ordersApi = resource("sales-orders");
import { usePerm } from "../../perm.jsx";
import {  inputCls, fmt, fmtDate, statusClass , toast, todayYmd } from "../../ui.js";
import { specShort, specKeyLabel } from "../../specs.js";
import { PageHeader, Section, ListHeader, DataTable, Logo, UnitSelect, SearchSelect, useSaving, LoadError, DialogBehavior, confirmClose, DateInput, LsxProgressChip } from "../../components.jsx";

// Bảng chuyển trạng thái (khớp backend). "Giao hàng" chỉ đặt qua nút Giao hàng (trừ tồn).
// Bản nháp chỉ được Hủy; sau khi đã giao không cho Hủy — hàng trả lại dùng nút "Khách trả hàng" (nhập lại kho).
// "Đã thanh toán 1 phần" / "Đã thanh toán" tự nhảy theo các lần thu ở mục Thanh toán — không chọn tay.
const DN_TRANSITIONS = {
  "Bản nháp":             ["Đã hủy"],
  "Giao hàng":            ["Đã xuất hóa đơn", "Chờ thanh toán"],
  "Đã xuất hóa đơn":      ["Chờ thanh toán"],
  "Chờ thanh toán":       ["Đã xuất hóa đơn"],
  "Đã thanh toán 1 phần": [],
  "Đã thanh toán":        [],
  "Đã hủy":               [],
};
const PAYABLE_STATUSES = ["Giao hàng", "Đã xuất hóa đơn", "Chờ thanh toán", "Đã thanh toán 1 phần", "Đã thanh toán"];

const today = todayYmd; // ngày giao mặc định theo giờ VN (toISOString lệch 1 ngày trước 7h sáng)

const MIN_ROWS = 8; // số dòng tối thiểu của bảng (in giấy cho đẹp)

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label} {required && <span className="text-rose-500">*</span>}</label>
    {children}
  </div>
);

/* ---- Lịch sử được trả của phiếu (chỉ xem) ----
 * Khách trả 1 cục bằng PHIẾU THANH TOÁN (menu Phiếu thanh toán) → hệ thống tự trừ vào phiếu giao cũ nhất trước.
 * Ở đây chỉ hiện phiếu này đã được trả bởi phiếu thanh toán nào (hoặc lần thu cũ trước đây).
 */
function PaymentHistory({ payments }) {
  const navigate = useNavigate();
  const list = payments.filter((p) => !p.is_cancelled);
  return (
    <Section title={`Đã được thanh toán (${list.length})`} bodyClass="p-0">
      {list.length === 0 ? (
        <div className="px-5 py-4 text-sm text-slate-400">Chưa được thanh toán. Thu tiền ở menu <b>Phiếu thanh toán</b> — hệ thống tự trừ vào phiếu giao cũ nhất trước.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Ngày</th>
              <th className="text-left px-4 py-2">Phiếu thanh toán</th>
              <th className="text-left px-4 py-2">Hình thức</th>
              <th className="text-right px-4 py-2">Số tiền trừ vào phiếu này</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((pm) => (
              <tr key={pm.id}>
                <td className="px-4 py-1.5">{fmtDate(pm.pay_date)}</td>
                <td className="px-4 py-1.5">
                  {pm.receipt_code
                    ? <button type="button" onClick={() => navigate("/payment-receipts", { state: { openId: pm.receipt_id } })}
                        className="font-medium text-blue-600 hover:underline" title="Mở phiếu thanh toán">{pm.receipt_code}</button>
                    : <span className="text-slate-500">{pm.method === "Số dư đầu kỳ" ? "Số dư đầu kỳ" : "Lần thu cũ"}</span>}
                </td>
                <td className="px-4 py-1.5 text-slate-600">{pm.method}</td>
                <td className="px-4 py-1.5 text-right font-semibold text-emerald-700">{fmt(pm.amount)} đ</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/* ---- Form phiếu giao hàng & thanh toán ----
 * MỘT bảng "Dòng hàng", chọn đơn NGAY TRÊN TỪNG DÒNG:
 *  - Dòng có chọn đơn: cột Sản phẩm chỉ liệt kê SP của đơn đó đã SX (ghi nhận ở LSX), chưa giao hết, còn tồn kho
 *    (API /deliveries/deliverable). Nhiều dòng thuộc nhiều đơn của cùng 1 khách → giao chung 1 phiếu.
 *  - Dòng "không theo đơn": chọn SP tự do trong kho NVL/BTP/TP (bán hạt nhựa, cuộn...).
 */
const NO_ORDER = ""; // giá trị cột Đơn hàng = "không theo đơn"

// K-12: Khách trả hàng — liệt kê đúng phần đã xuất khi giao (SP · lô · thông số · vị trí),
// nhập lại vào vị trí người nhập chọn (mặc định chỗ đã xuất). Không đổi công nợ.
const specLabel = (k) => specKeyLabel(k, "—");
function ReturnModal({ id, noteCode, lookups, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [qty, setQty] = useState({});   // trx_id → SL trả
  const [loc, setLoc] = useState({});   // trx_id → vị trí nhận
  const [head, setHead] = useState({ return_date: today(), note: "" });
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState(""); const [tryN, setTryN] = useState(0);
  useEffect(() => {
    api.returns(id).then((d) => {
      setData(d);
      setLoc(Object.fromEntries((d.lines || []).map((l) => [l.trx_id, l.location_id || ""])));
    }).catch((e) => setLoadErr(e.message || "Lỗi máy chủ"));
  }, [id, tryN]);
  const left = (l) => Number(l.shipped_qty) - Number(l.returned_qty);
  const save = async () => {
    const items = (data?.lines || []).filter((l) => Number(qty[l.trx_id]) > 0)
      .map((l) => ({ trx_id: l.trx_id, quantity: Number(qty[l.trx_id]), location_id: loc[l.trx_id] }));
    if (!items.length) return toast.error("Nhập số lượng trả cho ít nhất 1 dòng");
    const over = (data.lines || []).find((l) => Number(qty[l.trx_id]) > left(l) + 1e-6);
    if (over) return toast.error(`${over.product_code}: chỉ còn trả được ${fmt(left(over))}`);
    if (items.some((x) => !x.location_id)) return toast.error("Chọn kho / vị trí nhận hàng trả");
    setSaving(true);
    try { const r = await api.createReturn(id, { ...head, items }); toast.success(r?.message || "Đã lập phiếu trả hàng"); onSaved(); }
    catch (e) { toast.error("Không trả được: " + e.message); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl p-6 space-y-4 max-h-[90vh] overflow-auto">
        <DialogBehavior onClose={onClose} />
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">Khách trả hàng — phiếu giao {noteCode}</h3>
          <button onClick={(e) => confirmClose(e, onClose)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        {!data ? (loadErr ? <LoadError message={`Không tải được hàng đã giao (${loadErr})`} onRetry={() => { setLoadErr(""); setTryN((n) => n + 1); }} /> : <div className="text-sm text-slate-400">Đang tải…</div>) : !data.lines.length ? (
          <div className="text-sm text-slate-500">Phiếu này chưa có dữ liệu xuất kho để trả.</div>
        ) : (<>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Ngày trả"><DateInput className={inputCls} value={head.return_date} onChange={(e) => setHead((h) => ({ ...h, return_date: e.target.value }))} /></Field>
            <div className="md:col-span-2"><Field label="Lý do / ghi chú"><input className={inputCls} value={head.note} placeholder="VD: giao nhầm màu, hàng lỗi…" onChange={(e) => setHead((h) => ({ ...h, note: e.target.value }))} /></Field></div>
          </div>
          <div className="rounded-lg border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="px-3 py-2 text-left">Sản phẩm</th><th className="px-3 py-2 text-left">Thông số · Lô</th>
                <th className="px-3 py-2 text-right">Đã giao</th><th className="px-3 py-2 text-right">Đã trả</th>
                <th className="px-3 py-2 text-right w-28">SL trả</th><th className="px-3 py-2 text-left w-56">Nhập về kho / vị trí</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.lines.map((l) => (
                  <tr key={l.trx_id}>
                    <td className="px-3 py-2"><span className="text-blue-600 font-medium">{l.product_code}</span> · {l.product_name}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{specLabel(l.spec_key)} · lô {l.lot_code || "—"}</td>
                    <td className="px-3 py-2 text-right">{fmt(l.shipped_qty)} <span className="text-xs text-slate-400">{l.unit || ""}</span></td>
                    <td className="px-3 py-2 text-right text-slate-500">{fmt(l.returned_qty)}</td>
                    <td className="px-3 py-2"><input type="number" min="0" step="any" disabled={left(l) <= 0} className={inputCls + " text-right no-spin"}
                      value={qty[l.trx_id] ?? ""} placeholder={left(l) > 0 ? `≤ ${fmt(left(l))}` : "đã trả hết"}
                      onChange={(e) => setQty((s) => ({ ...s, [l.trx_id]: e.target.value }))} /></td>
                    <td className="px-3 py-2"><select className={inputCls} value={loc[l.trx_id] || ""} disabled={left(l) <= 0}
                      onChange={(e) => setLoc((s) => ({ ...s, [l.trx_id]: e.target.value }))}>
                      <option value="">-- Chọn vị trí --</option>
                      {(lookups.locations || []).map((x) => <option key={x.id} value={x.id}>{x.warehouse_name} · {x.name}</option>)}
                    </select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.returns.length > 0 && (
            <div className="text-xs text-slate-500">Đã trả trước đó: {data.returns.map((r) => `${r.return_code} (${fmtDate(r.return_date)}, ${fmt(r.total_qty)})`).join(" · ")}</div>
          )}
          <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Trả hàng chỉ nhập lại kho — công nợ của phiếu giao không tự thay đổi.</div>
          <div className="flex justify-end gap-2">
            <button onClick={(e) => confirmClose(e, onClose)} className="btn-ghost">Đóng</button>
            <button onClick={save} disabled={saving} className="btn-primary"><RotateCcw size={16} /> {saving ? "Đang lưu…" : "Xác nhận trả hàng"}</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

function DeliveryForm({ lookups, editId, initialOrderId, onBack, onSaved, onPrint, onOpenOrder, onOpenProductionOrder }) {
  const { can, fpermSecret } = usePerm();
  const moneyPerm = fpermSecret("deliveries", "amounts");
  const showMoney = moneyPerm !== "hidden";
  const moneyEdit = moneyPerm === "edit";
  const [editing, setEditing] = useState(!editId);
  const [f, setF] = useState({ customer_id: "", delivery_date: today(), status: "Bản nháp", note: "", paid_amount: "" });
  // dòng phiếu: theo đơn (có sales_order_item_id) hoặc tự do. Phiếu mới → có sẵn 1 dòng trống (đỡ bấm "Thêm dòng")
  const [rows, setRows] = useState(() => (editId || initialOrderId ? [] : [
    { _k: 1, sales_order_id: "", sales_order_item_id: "", product_id: "", product_name: "", specs: {}, unit: "", unit_price: "", quantity: "" },
  ]));
  const [seq, setSeq] = useState(2);
  const [cands, setCands] = useState([]);         // đơn giao được của khách: [{sales_order_id, order_code, status, lines:[...]}]
  const [savedItems, setSavedItems] = useState([]); // dòng đã lưu (chế độ xem)
  const [noteTotal, setNoteTotal] = useState(null);  // tổng tiền ĐÃ LƯU của phiếu (dùng khi chỉ xem)
  const [payments, setPayments] = useState([]);      // phiếu này đã được trả bởi phiếu thanh toán nào
  const [debtInfo, setDebtInfo] = useState(null);    // công nợ của khách đang chọn (cảnh báo nợ xấu / chặn hạn mức)
  const [noteCode, setNoteCode] = useState("");
  const [savedCustomer, setSavedCustomer] = useState(""); // khách ĐÃ LƯU của phiếu (để biết người dùng có đổi khách không)
  const [stock, setStock] = useState([]);         // tồn kho cho dòng không theo đơn
  const [returning, setReturning] = useState(false); // hộp thoại Khách trả hàng (K-12)
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const isDraft = f.status === "Bản nháp";
  const picking = editing && isDraft; // đang chọn / sửa dòng hàng

  useEffect(() => { inventory.list().then(setStock).catch((e) => toast.error("Không tải được tồn kho — cột tồn của dòng không theo đơn sẽ trống: " + e.message)); }, []);
  // S-05: lỗi tải công nợ → báo + nút Thử lại (trước đây im lặng, mất cảnh báo nợ xấu)
  const [debtErr, setDebtErr] = useState(false);
  const [debtTry, setDebtTry] = useState(0);
  // Công nợ của khách: chỉ cần khi đang lập phiếu (Bản nháp) — cảnh báo nợ xấu, chặn khi vượt hạn mức
  useEffect(() => {
    if (!f.customer_id || !isDraft) { setDebtInfo(null); setDebtErr(false); return; }
    let alive = true;
    paymentReceipts.customer(f.customer_id)
      .then((d) => { if (alive) { setDebtInfo(d); setDebtErr(false); } })
      .catch((e) => { if (alive) { setDebtInfo(null); setDebtErr(true); toast.error("Không tải được công nợ khách: " + e.message); } });
    return () => { alive = false; };
  }, [f.customer_id, isDraft, debtTry]);
  // Hạn mức chỉ chặn TẠO phiếu mới; phiếu nháp đã có vẫn sửa / giao được
  // Chặn khi TẠO phiếu, hoặc khi ĐỔI phiếu nháp sang khách khác — khớp chốt chặn backend (create + update).
  // Phiếu nháp giữ nguyên khách cũ thì vẫn sửa / giao được.
  const blockedNew = debtInfo?.level === "blocked" && (!editId || f.customer_id !== savedCustomer);
  // Gộp tồn theo sản phẩm (cả NVL/BTP/TP, bỏ Phế liệu) cho dòng không theo đơn
  const stockByProduct = React.useMemo(() => {
    const m = new Map();
    stock.filter((s) => ["NVL", "BTP", "TP"].includes(s.warehouse_type) && Number(s.quantity) > 0).forEach((s) => {
      const cur = m.get(s.product_id) || { product_id: s.product_id, product_name: s.product_name, unit: s.unit, qty: 0, wh: new Set() };
      cur.qty += Number(s.quantity) || 0; cur.wh.add(s.warehouse_type); if (!cur.unit) cur.unit = s.unit;
      m.set(s.product_id, cur);
    });
    return m;
  }, [stock]);

  // Tra nhanh dòng đơn giao được theo sales_order_item_id
  const lineById = React.useMemo(() => {
    const m = new Map();
    cands.forEach((o) => o.lines.forEach((l) => m.set(l.sales_order_item_id, { ...l, sales_order_id: o.sales_order_id, order_code: o.order_code })));
    return m;
  }, [cands]);

  const newRow = (k, extra = {}) => ({ _k: k, sales_order_id: NO_ORDER, sales_order_item_id: "", product_id: "", product_name: "", specs: {}, unit: "", unit_price: "", quantity: "", ...extra });
  const rowFromLine = (k, l) => newRow(k, {
    sales_order_id: l.sales_order_id, sales_order_item_id: l.sales_order_item_id, product_id: l.product_id,
    product_name: l.product_name, specs: l.specs || {}, unit: l.unit || "", unit_price: l.unit_price ?? "", quantity: l.suggested || "",
  });

  // Nạp đơn giao được của khách → trả về danh sách (để dựng dòng sẵn khi mở từ đơn hàng)
  const [candLoading, setCandLoading] = useState(false);
  const loadCands = async (cid) => {
    if (!cid) { setCands([]); return []; }
    setCandLoading(true);
    try { const list = (await api.deliverable(cid, editId)) || []; setCands(list); return list; }
    catch (e) { toast.error("Lỗi tải hàng giao được: " + e.message); return []; }
    finally { setCandLoading(false); }
  };

  const load = useCallback(() => {
    if (!editId) return;
    api.get(editId).then(async (d) => {
      setF({ customer_id: d.customer_id, delivery_date: d.delivery_date?.slice(0, 10) || today(), status: d.status, note: d.note || "", paid_amount: d.paid_amount ?? "" });
      setSavedCustomer(d.customer_id);
      const its = d.items || [];
      setSavedItems(its);
      setNoteTotal(d.total_amount ?? null);
      setPayments(d.payments || []);
      setNoteCode(d.note_code || "");
      setRows(its.map((it, i) => newRow(i + 1, {
        sales_order_id: it.sales_order_id || NO_ORDER, sales_order_item_id: it.sales_order_item_id || "",
        product_id: it.product_id || "", product_name: it.product_name || "", specs: it.specs || {}, unit: it.unit || "",
        unit_price: it.unit_price ?? "", quantity: it.quantity, order_code: it.sales_order_code || "",
      })));
      setSeq(its.length + 1);
      if (d.status === "Bản nháp" && d.customer_id) await loadCands(d.customer_id);
    }).catch((e) => toast.error("Lỗi tải phiếu: " + e.message));
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  // Mở từ chi tiết đơn hàng → chọn sẵn khách + dựng sẵn các dòng giao được của đơn đó
  useEffect(() => {
    if (editId || !initialOrderId) return;
    api.fromOrder(initialOrderId).then(async (d) => {
      setF((s) => ({ ...s, customer_id: d.customer_id }));
      const list = await loadCands(d.customer_id);
      const o = list.find((x) => x.sales_order_id === d.sales_order_id);
      const lines = (o?.lines || []).filter((l) => l.suggested > 0);
      setRows(lines.map((l, i) => rowFromLine(i + 1, { ...l, sales_order_id: o.sales_order_id })));
      setSeq(lines.length + 1);
      if (!lines.length) toast("Đơn này chưa có hàng đã sản xuất còn tồn kho để giao.");
    }).catch((e) => toast.error("Lỗi nạp đơn hàng: " + e.message));
  }, [initialOrderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Đổi khách: bỏ các dòng theo đơn của khách cũ, giữ dòng không theo đơn; hết dòng thì chừa sẵn 1 dòng trống
  const onCustomer = (cid) => {
    setF((s) => ({ ...s, customer_id: cid }));
    setRows((a) => {
      const keep = a.filter((r) => !r.sales_order_item_id && r.sales_order_id === NO_ORDER);
      return keep.length ? keep : [newRow(seq)];
    });
    setSeq((n) => n + 1);
    loadCands(cid);
  };

  const addRow = () => { setRows((a) => [...a, newRow(seq)]); setSeq((n) => n + 1); };
  const rmRow = (k) => setRows((a) => a.filter((r) => r._k !== k));
  const upRow = (k, patch) => setRows((a) => a.map((r) => (r._k === k ? { ...r, ...patch } : r)));
  const usedItemIds = new Set(rows.map((r) => r.sales_order_item_id).filter(Boolean));

  // Chọn đơn cho dòng: xóa SP đang chọn; đơn chỉ còn 1 SP chưa dùng → chọn luôn
  const onRowOrder = (r, orderId) => {
    if (orderId === r.sales_order_id) return;
    if (!orderId) { upRow(r._k, newRow(r._k)); return; }
    const o = cands.find((x) => x.sales_order_id === orderId);
    const free = (o?.lines || []).filter((l) => !usedItemIds.has(l.sales_order_item_id));
    upRow(r._k, free.length === 1 ? rowFromLine(r._k, { ...free[0], sales_order_id: orderId }) : newRow(r._k, { sales_order_id: orderId }));
  };
  // Chọn sản phẩm: dòng theo đơn → value = sales_order_item_id; dòng tự do → value = product_id
  const onRowProduct = (r, v) => {
    if (r.sales_order_id) {
      const l = lineById.get(v); if (!l) return;
      upRow(r._k, rowFromLine(r._k, l));
    } else {
      if (rows.some((x) => x._k !== r._k && !x.sales_order_item_id && x.product_id === v)) { toast.error("Sản phẩm đã có ở dòng khác"); return; }
      const s = stockByProduct.get(v); if (!s) return;
      upRow(r._k, { product_id: v, product_name: s.product_name, unit: s.unit || "", specs: {}, sales_order_item_id: "" });
    }
  };

  const orderOptions = [{ value: NO_ORDER, label: "— Không theo đơn —" }, ...cands.map((o) => ({ value: o.sales_order_id, label: `${o.order_code} · ${o.status}` }))];
  const productOptions = (r) => {
    if (!r.sales_order_id) return [...stockByProduct.values()].map((s) => ({ value: s.product_id, label: `${s.product_name} · tồn ${fmt(s.qty)} ${s.unit || ""} (${[...s.wh].join("/")})` }));
    const o = cands.find((x) => x.sales_order_id === r.sales_order_id);
    return (o?.lines || []).filter((l) => l.sales_order_item_id === r.sales_order_item_id || !usedItemIds.has(l.sales_order_item_id))
      .map((l) => ({ value: l.sales_order_item_id, label: `${l.product_name}${specShort(l.specs) ? ` · ${specShort(l.specs)}` : ""}` }));
  };
  // Số liệu tham chiếu của dòng: theo đơn → từ API giao được; tự do → tồn kho theo SP
  const infoOf = (r) => {
    if (r.sales_order_item_id) return lineById.get(r.sales_order_item_id) || null;
    const s = stockByProduct.get(r.product_id);
    return s ? { stock: s.qty, free: true } : null;
  };

  const validRows = rows.filter((r) => r.product_id && Number(r.quantity) > 0);
  // Tổng hợp theo SP + thông số so với tồn kho (nhiều dòng / nhiều đơn dùng chung tồn)
  const stockSummary = (() => {
    const m = new Map();
    validRows.forEach((r) => {
      const inf = infoOf(r); if (!inf) return;
      const key = r.sales_order_item_id ? `${r.product_id}|${inf.spec_key}` : `${r.product_id}|*`;
      const cur = m.get(key) || { name: r.product_name, specs: r.sales_order_item_id ? r.specs : {}, unit: r.unit, stock: inf.stock, qty: 0 };
      cur.qty += Number(r.quantity) || 0; m.set(key, cur);
    });
    return [...m.values()];
  })();
  const shortList = stockSummary.filter((x) => x.qty > x.stock + 1e-6);

  const amountOf = (r) => (Number(r.quantity) || 0) * (Number(r.unit_price) || 0);
  // Đang sửa → tính từ dòng; chỉ xem → tổng đã lưu của phiếu (khớp danh sách, bản in)
  const total = !editing && noteTotal != null ? Number(noteTotal) || 0 : rows.reduce((s, r) => s + amountOf(r), 0);
  const debt = total - (Number(f.paid_amount) || 0);

  const [saving, guard] = useSaving();
  const save = async () => {
    if (!f.customer_id) return toast.error("Chọn khách hàng");
    if (editId && f.status === "Đã hủy" && !confirm(`Hủy phiếu giao ${noteCode || ""}?\nPhiếu đã hủy không khôi phục được.`)) return;
    if (blockedNew) return toast.error(editId
      ? "Khách mới chọn đang nợ vượt hạn mức — không thể chuyển phiếu sang khách này. Cần lập Phiếu thanh toán thu bớt nợ trước."
      : "Khách nợ vượt hạn mức — không thể tạo phiếu giao mới. Cần lập Phiếu thanh toán thu bớt nợ trước.");
    let payloadItems;
    if (isDraft) {
      if (!validRows.length) return toast.error("Cần ít nhất 1 dòng có sản phẩm và SL giao > 0");
      // Cảnh báo (không chặn) khi giao DƯ so với còn phải giao của đơn — sản xuất dư là bình thường
      const over = validRows.filter((r) => { const l = r.sales_order_item_id && lineById.get(r.sales_order_item_id); return l && Number(r.quantity) > l.remaining + 1e-6; });
      if (over.length && !confirm(`Có ${over.length} dòng giao DƯ so với số còn phải giao (${over.map((r) => { const l = lineById.get(r.sales_order_item_id); return `${l.order_code} · ${r.product_name}: giao ${fmt(Number(r.quantity))} / còn ${fmt(l.remaining)}`; }).join("; ")}).\nVẫn cho giao. Tiếp tục lưu?`)) return;
      if (shortList.length && !confirm(`Tổng SL giao vượt tồn kho: ${shortList.map((x) => `${x.name}: giao ${fmt(x.qty)} / tồn ${fmt(x.stock)}`).join("; ")}.\nVẫn lưu nháp được, nhưng bấm Giao hàng sẽ bị chặn nếu chưa đủ tồn. Tiếp tục?`)) return;
      payloadItems = validRows.map((r) => ({
        sales_order_item_id: r.sales_order_item_id || null, product_id: r.product_id, product_name: r.product_name,
        specs: r.specs || {}, unit: r.unit, unit_price: r.unit_price, quantity: r.quantity,
      }));
    }
    // Phiếu đã rời Bản nháp: chỉ lưu thông tin phiếu (trạng thái, ghi chú, đã trả) — dòng hàng đã chốt
    const body = { ...f, ...(payloadItems ? { items: payloadItems } : {}) };
    // B7: đơn giá lệch đơn hàng → chỉ cảnh báo sau khi lưu (không chặn)
    const warnPrice = (r) => { if (r?.warnings?.length) toast(`⚠ Đơn giá khác đơn hàng:\n${r.warnings.join("\n")}`, { duration: 8000 }); };
    try {
      if (editId) {
        warnPrice(await api.update(editId, body));
        toast.success("Đã lưu thành công");
        setEditing(false); load(); // ở lại màn chi tiết
      } else {
        const created = await api.create(body); warnPrice(created);
        toast.success("Đã lưu thành công"); onSaved(created?.id); // tạo mới → ở lại màn chi tiết của bản ghi vừa tạo
      }
    } catch (e) { toast.error("Lỗi lưu phiếu: " + e.message); }
  };
  const del = async () => { if (!confirm(`Xóa phiếu giao ${noteCode || ""}?`)) return; try { await api.remove(editId); toast.success("Đã xóa thành công"); onSaved(); } catch (e) { toast.error("Lỗi xóa: " + e.message); } };
  const ship = async () => {
    if (!confirm("Xác nhận GIAO HÀNG cho khách?\nHệ thống sẽ tạo phiếu xuất kho (Giao hàng cho khách) và TRỪ TỒN theo số lượng giao (dòng theo đơn ưu tiên lô do chính LSX của đơn làm ra).")) return;
    try { const r = await api.ship(editId); toast.success(r?.message || "Đã giao hàng"); load(); }
    catch (e) { toast.error("Không giao được: " + e.message); }
  };

  const numCls = inputCls + " text-right no-spin";
  // Bề rộng ô số theo ch (1 ch = 1 chữ số), co giãn theo zoom: SL ~5 chữ số + thập phân, đơn giá ~8 chữ số
  const qtyW = { minWidth: "11ch" }, priceW = { minWidth: "12ch" };
  const dash = <span className="text-slate-300">—</span>;
  return (
    <div className="space-y-5">
      <PageHeader title={!editId ? "Tạo phiếu giao hàng" : editing ? "Sửa phiếu giao hàng" : "Chi tiết phiếu giao hàng"} onBack={onBack}
        actions={editId && !editing ? (<>
          {isDraft && can("deliveries", "approve") &&
            <button onClick={() => guard(ship)} disabled={saving} className="btn-primary"><Truck size={16} /> {saving ? "Đang xử lý…" : "Giao hàng"}</button>}
          {PAYABLE_STATUSES.includes(f.status) && can("deliveries", "approve") &&
            <button onClick={() => setReturning(true)} className="btn-ghost"><RotateCcw size={16} /> Khách trả hàng</button>}
          <button onClick={() => onPrint?.(editId)} className="btn-ghost"><Printer size={16} /> In phiếu</button>
          {can("deliveries", "edit") && <button onClick={() => setEditing(true)} className="btn-ghost"><Pencil size={16} /> Sửa</button>}
          {can("deliveries", "delete") && ["Bản nháp", "Đã hủy"].includes(f.status) &&<button onClick={del} className="btn-ghost" style={{ color: "#e11d48" }}><Trash2 size={16} /> Xóa</button>}
        </>) : (<>
          {editId && <button onClick={() => { setEditing(false); load(); }} className="btn-ghost">Hủy</button>}
          <button onClick={() => guard(save)} disabled={blockedNew || saving} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            title={blockedNew ? "Khách nợ vượt hạn mức" : undefined}><Save size={16} /> {saving ? "Đang lưu…" : "Lưu phiếu"}</button>
        </>)} />

      {returning && <ReturnModal id={editId} noteCode={noteCode} lookups={lookups}
        onClose={() => setReturning(false)} onSaved={() => { setReturning(false); load(); }} />}

      {isDraft && <DebtBanner info={debtInfo} context="delivery" />}
      {isDraft && debtErr && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 flex items-center gap-3">
          Không tải được công nợ của khách — chưa kiểm được nợ xấu / hạn mức.
          <button onClick={() => setDebtTry((n) => n + 1)} className="btn-ghost py-1 text-sm">Thử lại</button>
        </div>
      )}

      <fieldset disabled={!editing} className="space-y-5">
        <Section title="Thông tin phiếu">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            <Field label="Khách hàng" required>
              <SearchSelect
                value={f.customer_id}
                onChange={onCustomer}
                disabled={!isDraft}
                options={lookups.customers.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="-- Chọn khách hàng --"
              />
            </Field>
            <Field label="Trạng thái">
              <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option value={f.status}>{f.status}{["Bản nháp", "Giao hàng"].includes(f.status) ? " (hệ thống)" : ""}</option>
                {(DN_TRANSITIONS[f.status] || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            {/* Ngày giao chốt = ngày bấm "Giao hàng" → sau đó khóa; không chọn ngày tương lai */}
            <Field label="Ngày giao"><DateInput className={inputCls} value={f.delivery_date} max={today()} disabled={!isDraft}
              title={!isDraft ? "Ngày giao đã chốt khi bấm Giao hàng" : undefined} onChange={(e) => set("delivery_date", e.target.value)} /></Field>
            <Field label="Ghi chú"><input className={inputCls} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
            {showMoney && <Field label="Tổng tiền phiếu">
              <div className={inputCls + " bg-slate-50 font-semibold text-slate-800"}>{fmt(total)} đ</div>
            </Field>}
            {showMoney && <Field label="Số tiền đã trả">
              {/* = tổng tiền các Phiếu thanh toán đã trừ vào phiếu này (mục "Đã được thanh toán" bên dưới) — không nhập tay */}
              <div className={inputCls + " bg-slate-50 font-semibold text-emerald-700"}>{fmt(Number(f.paid_amount) || 0)} đ</div>
            </Field>}
            {showMoney && <Field label="Công nợ (còn lại)">
              <div className={inputCls + " bg-slate-50 font-bold " + (debt > 0 ? "text-rose-600" : "text-emerald-600")}>{fmt(debt)} đ</div>
            </Field>}
          </div>
        </Section>

        <Section title="Dòng hàng" bodyClass="p-0">
          {picking ? (
          <>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2.5 w-44">Đơn hàng</th>
                <th className="text-left px-3 py-2.5 min-w-[220px]">Sản phẩm · thông số</th>
                <th className="text-right px-2 py-2.5 w-20" title="SL khách đặt">Đặt</th>
                <th className="text-right px-2 py-2.5 w-20" title="Đã giao ở các phiếu đã giao">Đã giao</th>
                <th className="text-right px-2 py-2.5 w-24" title="Đã nhập kho từ LSX − đã giao">SX chưa giao</th>
                <th className="text-right px-2 py-2.5 w-20" title="Tồn kho (NVL/BTP/TP)">Tồn kho</th>
                <th className="text-right px-2 py-2.5 w-28 text-blue-700">SL giao</th>
                <th className="text-left px-2 py-2.5 w-14">ĐVT</th>
                {showMoney && <th className="text-right px-2 py-2.5 w-28">Đơn giá</th>}
                {showMoney && <th className="text-right px-3 py-2.5 w-28">Thành tiền</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const inf = infoOf(r);
                const ord = !!r.sales_order_id;
                const giao = Number(r.quantity) || 0;
                const overOrder = ord && inf && !inf.free && giao > inf.remaining + 1e-6;
                const overStock = inf && giao > inf.stock + 1e-6;
                const lost = ord && r.sales_order_item_id && !inf; // dòng đã lưu, nay không còn đủ điều kiện giao
                return (
                  <tr key={r._k}>
                    <td className="px-3 py-1.5">
                      <SearchSelect value={r.sales_order_id} onChange={(v) => onRowOrder(r, v)} disabled={!f.customer_id}
                        options={lost && !cands.some((o) => o.sales_order_id === r.sales_order_id) ? [...orderOptions, { value: r.sales_order_id, label: r.order_code || "Đơn cũ" }] : orderOptions}
                        placeholder={f.customer_id ? "— Không theo đơn —" : "Chọn khách trước"} />
                    </td>
                    <td className="px-3 py-1.5">
                      {lost ? (
                        <div className="text-slate-700">{r.product_name}{specShort(r.specs) ? <span className="text-slate-400"> · {specShort(r.specs)}</span> : null}
                          <div className="text-xs text-amber-600">Không còn đủ điều kiện giao (hết tồn / đã giao đủ) — xóa dòng hoặc giữ nguyên</div></div>
                      ) : (
                        <SearchSelect value={ord ? r.sales_order_item_id : r.product_id} onChange={(v) => onRowProduct(r, v)}
                          options={productOptions(r)} placeholder={ord ? "-- SP của đơn (đã SX, còn tồn) --" : "-- Chọn SP trong kho (NVL/BTP/TP) --"} />
                      )}
                      {inf?.in_draft > 0 && <div className="text-xs text-amber-600 mt-0.5">{fmt(inf.in_draft)} đang ở phiếu nháp khác</div>}
                    </td>
                    <td className="px-2 py-1.5 text-right text-slate-600">{ord && inf && !inf.free ? fmt(inf.ordered) : dash}</td>
                    <td className="px-2 py-1.5 text-right text-slate-600">{ord && inf && !inf.free ? fmt(inf.delivered) : dash}</td>
                    <td className="px-2 py-1.5 text-right text-slate-600">{ord && inf && !inf.free ? fmt(inf.produced_left) : dash}</td>
                    <td className={"px-2 py-1.5 text-right " + (overStock ? "text-rose-600 font-semibold" : "text-slate-600")}>{inf ? fmt(inf.stock) : dash}</td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" className={numCls + " font-semibold text-blue-700" + (overOrder || overStock ? " !border-amber-400 !ring-2 !ring-amber-200" : "")}
                        style={qtyW} value={r.quantity ?? ""} onChange={(e) => upRow(r._k, { quantity: e.target.value })} disabled={!r.product_id}
                        title={overStock ? `Giao ${fmt(giao)} vượt tồn ${fmt(inf.stock)} — không đủ tồn sẽ không giao được` : overOrder ? `Giao dư ${fmt(giao - inf.remaining)} so với còn phải giao — vẫn cho giao` : inf?.suggested != null ? `Gợi ý ${fmt(inf.suggested)}` : undefined} />
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{r.unit || "—"}</td>
                    {showMoney && <td className="px-2 py-1.5"><input type="number" min="0" className={numCls} disabled={!moneyEdit || !r.product_id} style={priceW} value={r.unit_price ?? ""} onChange={(e) => upRow(r._k, { unit_price: e.target.value })} /></td>}
                    {showMoney && <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{r.product_id ? fmt(amountOf(r)) : "—"}</td>}
                    <td className="px-2 py-1.5 text-center"><button type="button" onClick={() => rmRow(r._k)} className="text-slate-400 hover:text-rose-600" title="Xóa dòng"><Trash2 size={15} /></button></td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={showMoney ? 11 : 9} className="px-4 py-8 text-center text-slate-400">
                {f.customer_id ? (candLoading ? "Đang tải đơn hàng của khách…" : cands.length ?"Bấm “Thêm dòng”, chọn đơn hàng rồi chọn sản phẩm (hoặc để “Không theo đơn” để bán hàng tồn kho)." : "Khách này chưa có hàng đã sản xuất chờ giao — bấm “Thêm dòng” để bán hàng tồn kho (không theo đơn).") : "Chọn khách hàng rồi bấm “Thêm dòng”."}
              </td></tr>}
            </tbody>
          </table>
          </div>
          <div className="p-3 border-t border-slate-100 bg-slate-50/40 flex flex-wrap items-start justify-between gap-3">
            <button type="button" onClick={addRow} disabled={!f.customer_id} className="btn-ghost text-blue-600 border-blue-200 hover:bg-blue-50"><Plus size={16} /> Thêm dòng</button>
            {stockSummary.length > 0 && (
              <div className="text-xs space-y-0.5 text-right">
                {stockSummary.map((x, i) => {
                  const lack = x.qty - x.stock;
                  return (
                    <div key={i}>
                      <span className="text-slate-500">{x.name}{specShort(x.specs) ? ` · ${specShort(x.specs)}` : ""}: </span>
                      <span className={lack > 1e-6 ? "text-rose-600 font-semibold" : "text-emerald-600 font-semibold"}>
                        giao {fmt(x.qty)} / tồn {fmt(x.stock)} {x.unit || ""}{lack > 1e-6 ? ` · thiếu ${fmt(lack)}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </>
          ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 w-36">Đơn hàng</th>
                <th className="text-left px-4 py-2.5">Lệnh SX · tiến độ</th>
                <th className="text-left px-4 py-2.5">Sản phẩm</th>
                <th className="text-left px-4 py-2.5">Thông số</th>
                <th className="text-right px-3 py-2.5 w-28">SL giao</th>
                <th className="text-left px-3 py-2.5 w-16">ĐVT</th>
                {showMoney && <th className="text-right px-4 py-2.5 w-28">Đơn giá</th>}
                {showMoney && <th className="text-right px-4 py-2.5 w-32">Thành tiền</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {savedItems.map((it) => (
                <tr key={it.id}>
                  <td className="px-4 py-1.5 font-medium text-blue-700">
                    {it.sales_order_code
                      ? <a href="#" onClick={(e) => { e.preventDefault(); onOpenOrder?.(it.sales_order_id); }} className="hover:underline" title="Mở đơn hàng">{it.sales_order_code}</a>
                      : <span className="text-slate-400 font-normal">Không theo đơn</span>}
                  </td>
                  <td className="px-4 py-1.5">
                    {it.production_orders?.length
                      ? <div className="flex flex-wrap gap-1.5">{it.production_orders.map((o) => <LsxProgressChip key={o.id} o={o} onOpen={onOpenProductionOrder} />)}</div>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-1.5 font-medium text-slate-800">{it.product_name || "—"}</td>
                  <td className="px-4 py-1.5 text-slate-500">{specShort(it.specs) || "—"}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{fmt(it.actual_quantity ?? it.quantity)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{it.unit || "—"}</td>
                  {showMoney && <td className="px-4 py-1.5 text-right">{fmt(it.unit_price)}</td>}
                  {showMoney && <td className="px-4 py-1.5 text-right font-semibold text-slate-800">{fmt(it.amount)}</td>}
                </tr>
              ))}
              {!savedItems.length && <tr><td colSpan={showMoney ? 8 : 6}className="px-4 py-8 text-center text-slate-400">Phiếu chưa có dòng hàng.</td></tr>}
            </tbody>
          </table>
          )}
        </Section>
      </fieldset>

      {showMoney && editId && !editing && PAYABLE_STATUSES.includes(f.status) && <PaymentHistory payments={payments} />}
    </div>
  );
}

/* ---- Phiếu in (template chung giao hàng + thanh toán) ---- */
function DeliveryVoucher({ id, onBack }) {
  const S = useAppSettings();
  const COMPANY = { name: S.company_name, tax: S.company_tax, address: S.company_address, phone: S.company_phone }; // Cài đặt hệ thống
  const { fpermSecret } = usePerm();
  const showMoney = fpermSecret("deliveries", "amounts") !== "hidden";
  const [d, setD] = useState(null);
  const [loadErr, setLoadErr] = useState(""); const [tryN, setTryN] = useState(0);
  useEffect(() => { api.get(id).then(setD).catch((e) => setLoadErr(e.message || "Lỗi máy chủ")); }, [id, tryN]);
  if (!d) return loadErr
    ? <LoadError className="mt-6" message={`Không tải được phiếu (${loadErr})`} onRetry={() => { setLoadErr(""); setTryN((n) => n + 1); }} />
    : <div className="text-slate-400 text-sm py-10">Đang tải phiếu…</div>;
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
          {d.sales_order_code && <div><b>Theo đơn hàng:</b> {d.sales_order_code}</div>}
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
                <td className={td}>{it ? (it.note || it.sales_order_code || "") : ""}</td>
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
export default function DeliveriesModule({ lookups, focusOrderId, onFocusConsumed, onOpenOrder, onOpenProductionOrder }) {
  const { can, fpermSecret } = usePerm();
  const showMoney = fpermSecret("deliveries", "amounts") !== "hidden";
  const [view, setView] = useState("list");
  const [editId, setEditId] = useState(null);
  const [newOrderId, setNewOrderId] = useState(null);
  const [voucherId, setVoucherId] = useState(null);
  const [rows, setRows] = useState([]);

  const [listLoading, setListLoading] = useState(true);
  const load = useCallback(async () => {
    setListLoading(true); try { setRows((await api.list({})) || []); } catch (e) { toast.error("Lỗi tải phiếu: " + e.message); } finally { setListLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Điều hướng từ chi tiết đơn hàng → mở form tạo phiếu, nạp sẵn đơn
  useEffect(() => {
    if (focusOrderId) { setEditId(null); setNewOrderId(focusOrderId); setView("form"); onFocusConsumed?.(); }
  }, [focusOrderId]); // eslint-disable-line

  const del = async (id) => { const r = rows.find((x) => x.id === id); if (!confirm(`Xóa phiếu giao ${r?.note_code || ""}${r?.customer_name ? ` – ${r.customer_name}` : ""}?`)) return; try { await api.remove(id); toast.success("Đã xóa thành công"); load(); } catch (e) { toast.error("Lỗi xóa: " + e.message); } };

  const resetToList = () => { setView("list"); setEditId(null); setNewOrderId(null); };
  if (view === "form") return <DeliveryForm key={editId || "new"} lookups={lookups} editId={editId} initialOrderId={newOrderId}
    onBack={() => { resetToList(); load(); }} onSaved={(newId) => { if (newId) { setEditId(newId); setNewOrderId(null); } else resetToList(); load(); }}
    onPrint={(id) => { setVoucherId(id); setView("voucher"); }} onOpenOrder={onOpenOrder} onOpenProductionOrder={onOpenProductionOrder} />;
  if (view === "voucher") return <DeliveryVoucher id={voucherId} onBack={() => setView("list")} />;

  const columns = [
    { key: "note_code", label: "Số phiếu", filter: "text", minWidth: "120px", render: (r) => <button onClick={() => { setEditId(r.id); setView("form"); }} className="font-medium text-blue-600 hover:underline">{r.note_code}</button> },
    { key: "customer_name", label: "Khách hàng", filter: "select", minWidth: "200px", tdClass: "text-slate-800" },
    { key: "sales_order_code", label: "Đơn hàng", filter: "text", minWidth: "120px", render: (r) => r.sales_order_code || "—" },
    { key: "delivery_date", label: "Ngày giao", filter: "date", minWidth: "130px", render: (r) => fmtDate(r.delivery_date) },
    { key: "item_count", label: "Số dòng", align: "center", minWidth: "80px" },
    ...(showMoney ? [
      { key: "total_amount", label: "Tổng tiền", align: "right", minWidth: "120px", render: (r) => <span className="font-semibold">{fmt(r.total_amount)} đ</span> },
      { key: "debt", label: "Công nợ", align: "right", minWidth: "120px", render: (r) => { const dbt = Number(r.total_amount || 0) - Number(r.paid_amount || 0); return <span className={`font-semibold ${dbt > 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(dbt)} đ</span>; } },
    ] : []),
    { key: "status", label: "Trạng thái", filter: "select", minWidth: "160px", render: (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span> },
    { key: "_act", label: "", align: "right", render: (r) => (<>
        <button onClick={() => { setVoucherId(r.id); setView("voucher"); }} title="In phiếu" className="text-slate-400 hover:text-emerald-600 p-1"><FileText size={15} /></button>
        <button onClick={() => { setEditId(r.id); setView("form"); }} title="Sửa" className="text-slate-400 hover:text-blue-600 p-1"><Pencil size={15} /></button>
        {can("deliveries", "delete") && ["Bản nháp", "Đã hủy"].includes(r.status) &&<button onClick={() => del(r.id)} title="Xóa" className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={15} /></button>}
      </>) },
  ];

  return (
    <div className="space-y-5">
      <ListHeader title="Phiếu giao hàng & thanh toán" actions={<>
        <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        {can("deliveries", "create") && <button onClick={() => { setEditId(null); setView("form"); }} className="btn-primary"><Plus size={16} /> Tạo phiếu</button>}
      </>} />
      <DataTable loading={listLoading} columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Chưa có phiếu giao hàng" />
    </div>
  );
}
