// src/modules/sales/PaymentReceipts.jsx — PHIẾU THANH TOÁN
// Khách trả 1 cục (không theo từng phiếu giao). Lưu phiếu → backend tự trừ vào phiếu giao còn nợ CŨ NHẤT TRƯỚC;
// phiếu giao đủ tiền tự chuyển "Đã thanh toán". Trả dư = tiền trả trước, tự trừ khi khách có phiếu giao mới.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RotateCcw, Save, Ban, Wallet, Pencil, ArrowRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { paymentReceipts as api } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import { inputCls, fmt, fmtDate, statusClass, toast, todayYmd } from "../../ui.js";
import { PageHeader, Section, ListHeader, DataTable, SearchSelect } from "../../components.jsx";
import { MoneyInput, DebtBanner, LevelBadge, vnd } from "./debtUi.jsx";

const today = todayYmd; // ngày theo giờ VN (không dùng toISOString — lệch 1 ngày trước 7h sáng)
const METHODS = ["Chuyển khoản", "Tiền mặt"];
const EMPTY = { customer_id: "", pay_date: today(), invoice_date: "", payer_name: "", method: "Chuyển khoản", content: "", amount: "", invoice_no: "", sales_order_ids: [] };

const Field = ({ label, required, children, className = "" }) => (
  <div className={className}>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label} {required && <span className="text-rose-500">*</span>}</label>
    {children}
  </div>
);

/* ---- Form lập / xem phiếu thanh toán ---- */
function ReceiptForm({ lookups, id, onBack, onSaved }) {
  const { fpermSecret } = usePerm();
  const canEdit = fpermSecret("deliveries", "amounts") === "edit";
  const isNew = !id;
  const [f, setF] = useState(EMPTY);
  const [rec, setRec] = useState(null);          // phiếu đã lưu (chế độ xem)
  const [editing, setEditing] = useState(isNew);
  const [info, setInfo] = useState(null);        // công nợ hiện tại của khách
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const load = useCallback(() => {
    if (!id) return;
    api.get(id).then((r) => {
      setRec(r);
      setF({
        customer_id: r.customer_id, pay_date: r.pay_date?.slice(0, 10) || "", invoice_date: r.invoice_date?.slice(0, 10) || "",
        payer_name: r.payer_name || "", method: r.method, content: r.content || "", amount: Number(r.amount),
        invoice_no: r.invoice_no || "", sales_order_ids: r.sales_order_ids || [],
      });
    }).catch((e) => toast.error("Lỗi tải phiếu: " + e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!f.customer_id) { setInfo(null); return; }
    let alive = true;
    api.customer(f.customer_id).then((d) => alive && setInfo(d)).catch(() => alive && setInfo(null));
    return () => { alive = false; };
  }, [f.customer_id, rec?.updated_at]);

  // Xem trước: số tiền sẽ trừ vào phiếu giao nào (cũ nhất trước) — chỉ khi lập phiếu mới
  const preview = useMemo(() => {
    if (!isNew || !info?.open_notes) return null;
    let left = Number(f.amount) || 0;
    const rows = info.open_notes.map((n) => {
      const due = Number(n.due) || 0;
      const take = Math.min(due, Math.max(0, left));
      left -= take;
      return { ...n, take, after: due - take };
    });
    return { rows, credit: Math.max(0, left), debtAfter: Math.max(0, (Number(info.debt) || 0) - (Number(f.amount) || 0)) };
  }, [isNew, info, f.amount]);

  const toggleOrder = (oid) => set("sales_order_ids", f.sales_order_ids.includes(oid) ? f.sales_order_ids.filter((x) => x !== oid) : [...f.sales_order_ids, oid]);

  const save = async () => {
    if (!f.customer_id) return toast.error("Chọn khách hàng");
    if (!f.pay_date) return toast.error("Nhập ngày thanh toán");
    if (isNew && !(Number(f.amount) > 0)) return toast.error("Nhập số tiền thanh toán lớn hơn 0");
    if (f.pay_date > todayYmd()) return toast.error("Ngày thanh toán không được sau hôm nay");
    // C1: số tiền vượt số khách đang nợ → phần dư thành tiền trả trước. Xác nhận lại để tránh gõ nhầm thừa số 0.
    if (isNew && info && Number(f.amount) > (Number(info.debt) || 0)) {
      const extra = Number(f.amount) - (Number(info.debt) || 0);
      if (!confirm(`Số tiền ${vnd(f.amount)} đ LỚN HƠN số khách đang nợ (${vnd(info.debt || 0)} đ).\nPhần dư ${vnd(extra)} đ sẽ giữ làm tiền trả trước.\n\nKiểm tra lại số tiền — tiếp tục lưu?`)) return;
    }
    setBusy(true);
    try {
      if (isNew) {
        const r = await api.create(f);
        toast.success(r.message || "Đã lưu phiếu thanh toán", { duration: 6000 });
        onSaved();
      } else {
        await api.update(id, f);
        toast.success("Đã cập nhật phiếu");
        setEditing(false); load();
      }
    } catch (e) { toast.error("Lỗi lưu phiếu: " + e.message); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    const reason = prompt(`Hủy phiếu ${rec.receipt_code} (${vnd(rec.amount)} đ)?\nCác phiếu giao đã được trừ tiền sẽ quay lại trạng thái còn nợ.\n\nNhập lý do hủy:`);
    if (reason === null) return;
    if (!reason.trim()) return toast.error("Cần nhập lý do hủy");
    try { await api.cancel(id, reason.trim()); toast.success("Đã hủy phiếu"); load(); }
    catch (e) { toast.error(e.message); }
  };

  const cancelled = rec?.is_cancelled;
  const custOptions = lookups.customers.map((c) => ({ value: c.id, label: c.name }));
  const orders = info?.orders || [];

  return (
    <div className="space-y-5">
      <PageHeader title={isNew ? "Lập phiếu thanh toán" : `Phiếu thanh toán ${rec?.receipt_code || ""}`} onBack={onBack}
        actions={!isNew && !editing ? (<>
          {canEdit && !cancelled && <button onClick={() => setEditing(true)} className="btn-ghost"><Pencil size={16} /> Sửa</button>}
          {canEdit && !cancelled && <button onClick={cancel} className="btn-ghost" style={{ color: "#e11d48" }}><Ban size={16} /> Hủy phiếu</button>}
        </>) : (<>
          {!isNew && <button onClick={() => { setEditing(false); load(); }} className="btn-ghost">Thôi</button>}
          <button onClick={save} disabled={busy} className="btn-primary"><Save size={16} /> Lưu phiếu</button>
        </>)} />

      {cancelled && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <b>Phiếu đã hủy</b>{rec.cancelled_by_name ? ` bởi ${rec.cancelled_by_name}` : ""} lúc {fmtDate(rec.cancelled_at)} — lý do: {rec.cancel_reason}
        </div>
      )}
      {isNew && <DebtBanner info={info} context="receipt" />}

      {/* Bố cục giống các màn khác (Phiếu giao hàng): các khối trải hết chiều ngang, xếp dọc */}
      <div className="space-y-5">
        <fieldset disabled={!editing}>
          <Section title="Thông tin thanh toán">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
              <Field label="Khách hàng" required>
                <SearchSelect value={f.customer_id} onChange={(v) => setF((s) => ({ ...s, customer_id: v, sales_order_ids: [] }))}
                  disabled={!isNew} options={custOptions} placeholder="-- Chọn khách hàng --" />
              </Field>
              <Field label="Số tiền thanh toán" required>
                {isNew
                  ? <MoneyInput value={f.amount} onChange={(v) => set("amount", v)} placeholder="0" />
                  : <div className={inputCls + " bg-slate-50 text-right font-bold text-emerald-700 tabular-nums"}>{vnd(f.amount)} đ</div>}
              </Field>
              <Field label="Hình thức thanh toán" required>
                <div className="flex gap-2">
                  {METHODS.map((m) => (
                    <button key={m} type="button" onClick={() => set("method", m)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${f.method === m ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Ngày thanh toán" required><input type="date" className={inputCls} value={f.pay_date} onChange={(e) => set("pay_date", e.target.value)} /></Field>
              <Field label="Ngày xuất hóa đơn"><input type="date" className={inputCls} value={f.invoice_date} onChange={(e) => set("invoice_date", e.target.value)} /></Field>
              <Field label="Số hóa đơn"><input className={inputCls} value={f.invoice_no} onChange={(e) => set("invoice_no", e.target.value)} placeholder="vd: 0001234" /></Field>
              <Field label="Người thanh toán"><input className={inputCls} value={f.payer_name} onChange={(e) => set("payer_name", e.target.value)} placeholder="Người bên khách trả tiền" /></Field>
              <Field label="Số đơn hàng" className="lg:col-span-2">
                {!f.customer_id ? <div className="text-sm text-slate-400 py-2">Chọn khách hàng trước</div>
                  : orders.length === 0 ? <div className="text-sm text-slate-400 py-2">Khách chưa có đơn hàng</div>
                  : (
                    <div className="flex flex-wrap gap-1.5">
                      {orders.map((o) => {
                        const on = f.sales_order_ids.includes(o.id);
                        return (
                          <button key={o.id} type="button" onClick={() => toggleOrder(o.id)} title={`${fmtDate(o.order_date)} · ${o.status}`}
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? "border-blue-500 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:border-blue-400"}`}>
                            {o.order_code}
                          </button>
                        );
                      })}
                    </div>
                  )}
                <div className="text-xs text-slate-400 mt-1">Chỉ để tham chiếu — tiền luôn trừ vào phiếu giao cũ nhất trước.</div>
              </Field>
              <Field label="Nội dung thanh toán" className="md:col-span-2 lg:col-span-3">
                <textarea rows={2} className={inputCls} value={f.content} onChange={(e) => set("content", e.target.value)} placeholder="vd: Thanh toán tiền hàng tháng 9" />
              </Field>
            </div>
          </Section>
        </fieldset>

        {/* Công nợ của khách + tiền lần này sẽ trừ vào phiếu giao nào (chỉ hiện sau khi chọn khách) */}
        {isNew && f.customer_id && info && !info.amounts_hidden && preview && (
          <Section title={`Công nợ của khách · ${preview.rows.length} phiếu giao còn nợ — trừ cũ nhất trước`} action={<LevelBadge level={info.level} />} bodyClass="p-0">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 text-sm">
              <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-slate-500">Đang nợ</div><div className="text-lg font-bold text-rose-600 tabular-nums">{vnd(info.debt)} đ</div></div>
              <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-slate-500">Tiền trả trước</div><div className="text-lg font-bold text-blue-700 tabular-nums">{vnd(info.credit)} đ</div></div>
              <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-slate-500">Thanh toán lần này</div><div className="text-lg font-bold text-emerald-700 tabular-nums">{vnd(f.amount)} đ</div></div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2"><div className="text-blue-700">Sau khi lưu còn nợ</div>
                <div className="text-lg font-bold text-blue-800 tabular-nums">{vnd(preview.debtAfter)} đ</div>
                {preview.credit > 0 && <div className="text-xs text-blue-700">dư {vnd(preview.credit)} đ → tiền trả trước</div>}
              </div>
            </div>
            {preview.rows.length === 0 ? <div className="px-4 pb-4 text-sm text-slate-400">Khách không còn nợ phiếu giao nào — toàn bộ số tiền sẽ là tiền trả trước.</div> : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase border-t border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-2">Phiếu giao</th><th className="text-left px-4 py-2">Ngày giao</th><th className="text-right px-4 py-2">Tuổi nợ</th>
                    <th className="text-right px-4 py-2">Tổng tiền</th><th className="text-right px-4 py-2">Còn nợ</th>
                    <th className="text-right px-4 py-2 text-emerald-700">Trừ lần này</th><th className="text-right px-4 py-2">Còn lại</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.rows.map((n) => {
                    const late = n.age_days > (info.settings?.bad_days ?? 30);
                    return (
                      <tr key={n.id} className={n.take > 0 ? "" : "text-slate-400"}>
                        <td className="px-4 py-1.5 font-medium">{n.note_code}</td>
                        <td className="px-4 py-1.5">{fmtDate(n.delivery_date)}</td>
                        <td className={`px-4 py-1.5 text-right ${late ? "text-rose-600 font-medium" : ""}`}>{n.age_days} ngày</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{vnd(n.total_amount)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{vnd(n.due)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums font-semibold text-emerald-700">{n.take > 0 ? vnd(n.take) : "—"}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">
                          {n.take > 0 && n.after <= 0.005
                            ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">Đã thanh toán</span>
                            : vnd(n.after)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>
        )}

        {!isNew && rec && (
          <Section title={`Đã trừ vào phiếu giao (${(rec.allocations || []).length})`} bodyClass="p-0">
            {(rec.allocations || []).length === 0 ? (
              <div className="px-4 py-4 text-sm text-slate-400">{cancelled ? "Phiếu đã hủy — không còn trừ vào phiếu giao nào." : "Chưa trừ vào phiếu giao nào (toàn bộ là tiền trả trước)."}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Phiếu giao</th><th className="text-left px-4 py-2">Ngày giao</th>
                    <th className="text-right px-4 py-2">Tổng tiền phiếu</th><th className="text-right px-4 py-2">Đã trừ từ phiếu này</th>
                    <th className="text-left px-4 py-2">Trạng thái phiếu giao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rec.allocations.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-1.5 font-medium">{a.note_code}</td>
                      <td className="px-4 py-1.5">{fmtDate(a.delivery_date)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{vnd(a.total_amount)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums font-semibold text-emerald-700">{vnd(a.amount)}</td>
                      <td className="px-4 py-1.5"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(a.status)}`}>{a.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {Number(rec.unallocated) > 0 && (
              <div className="border-t border-slate-100 px-4 py-2 text-sm text-blue-700">
                Còn dư <b>{vnd(rec.unallocated)} đ</b> tiền trả trước — tự trừ khi khách có phiếu giao mới.
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

/* ---- Module chính: danh sách phiếu thanh toán ---- */
export default function PaymentReceiptsModule({ lookups }) {
  const { fpermSecret } = usePerm();
  const moneyPerm = fpermSecret("deliveries", "amounts");
  const location = useLocation();
  const navigate = useNavigate();
  // Mở thẳng 1 phiếu khi được dẫn tới từ nơi khác (vd mục "Đã được thanh toán" của Phiếu giao hàng)
  const focusId = location.state?.openId || null;
  const [view, setView] = useState(focusId ? "form" : "list");
  const [openId, setOpenId] = useState(focusId);
  useEffect(() => {
    if (!focusId) return;
    setOpenId(focusId); setView("form");
    navigate(location.pathname, { replace: true, state: null }); // xóa state để F5 / quay lại không mở lại
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    try { setRows((await api.list()) || []); } catch (e) { toast.error("Lỗi tải phiếu thanh toán: " + e.message); }
  }, []);
  useEffect(() => { if (moneyPerm !== "hidden") load(); }, [load, moneyPerm]);

  if (moneyPerm === "hidden") return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Bạn không có quyền xem số liệu tiền / thanh toán.</div>
  );
  const back = () => { setView("list"); setOpenId(null); load(); };
  if (view === "form") return <ReceiptForm lookups={lookups} id={openId} onBack={back} onSaved={back} />;

  const open = (id) => { setOpenId(id); setView("form"); };
  const columns = [
    { key: "receipt_code", label: "Số phiếu", filter: "text", minWidth: "110px", render: (r) => <button onClick={() => open(r.id)} className="font-medium text-blue-600 hover:underline">{r.receipt_code}</button> },
    { key: "pay_date", label: "Ngày TT", filter: "date", minWidth: "110px", render: (r) => fmtDate(r.pay_date) },
    { key: "customer_name", label: "Khách hàng", filter: "select", minWidth: "180px", tdClass: "text-slate-800" },
    { key: "method", label: "Hình thức", filter: "select", minWidth: "120px" },
    { key: "amount", label: "Số tiền", align: "right", minWidth: "130px", render: (r) => <span className={`font-semibold tabular-nums ${r.is_cancelled ? "line-through text-slate-400" : "text-emerald-700"}`}>{vnd(r.amount)} đ</span> },
    { key: "note_count", label: "Trừ vào", align: "center", minWidth: "90px", render: (r) => r.is_cancelled ? "—" : `${r.note_count} phiếu` },
    { key: "unallocated", label: "Trả trước còn", align: "right", minWidth: "120px", render: (r) => Number(r.unallocated) > 0 ? <span className="text-blue-700 tabular-nums">{vnd(r.unallocated)} đ</span> : <span className="text-slate-300">—</span> },
    { key: "invoice_no", label: "Số HĐ", filter: "text", minWidth: "100px", render: (r) => r.invoice_no || "—" },
    { key: "order_codes", label: "Đơn hàng", filter: "text", minWidth: "120px", render: (r) => r.order_codes || "—" },
    { key: "state", label: "Trạng thái", filter: "select", minWidth: "110px", filterValue: (r) => (r.is_cancelled ? "Đã hủy" : "Hiệu lực"),
      render: (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${r.is_cancelled ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"}`}>{r.is_cancelled ? "Đã hủy" : "Hiệu lực"}</span> },
  ];

  return (
    <div className="space-y-5">
      <ListHeader title="Phiếu thanh toán" actions={<>
        <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        {moneyPerm === "edit" && <button onClick={() => open(null)} className="btn-primary"><Plus size={16} /> Lập phiếu thanh toán</button>}
      </>} />
      <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-sm text-blue-800">
        <Wallet size={16} className="shrink-0" />
        Khách trả 1 lần cho nhiều phiếu giao: tiền tự trừ vào phiếu giao <b>cũ nhất trước</b> <ArrowRight size={14} /> phiếu đủ tiền tự chuyển <b>Đã thanh toán</b>. Trả dư được giữ làm tiền trả trước.
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Chưa có phiếu thanh toán" />
    </div>
  );
}
