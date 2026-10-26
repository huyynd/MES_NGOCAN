// src/modules/sales/Receivables.jsx — BÁO CÁO CÔNG NỢ theo khách hàng
//   Phải trả  = tổng tiền các phiếu giao đã giao      Đã trả = tổng Phiếu thanh toán (+ lần thu cũ)
//   Còn nợ    = phải trả − phần đã trừ                Trả trước = tiền thanh toán dư chưa trừ
//   Nợ xấu    = có phiếu giao còn nợ quá N ngày (app_settings.debt_bad_days, mặc định 30) → cảnh báo
//   Vượt hạn mức = nợ > app_settings.debt_limit_amount (mặc định 300 triệu) → không cho tạo phiếu giao mới
import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, Download, X, AlertTriangle, Ban, Wallet, Users, Receipt, Clock, Plus, Save, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import { receivables as api, paymentReceipts } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import { fmtDate, statusClass, toast, todayYmd, inputCls } from "../../ui.js";
import { ListHeader, DataTable, LoadError, DialogBehavior, SearchSelect, DateInput } from "../../components.jsx";
import { LevelBadge, LEVELS, vnd, MoneyInput } from "./debtUi.jsx";

function Card({ label, value, sub, icon: Icon, tone = "slate", onClick, active }) {
  const t = {
    slate: "text-slate-800", rose: "text-rose-600", emerald: "text-emerald-700", amber: "text-amber-700", blue: "text-blue-700",
  }[tone];
  const body = (<>
    <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      <span className="truncate">{label}</span><Icon size={15} className="shrink-0 text-slate-400" />
    </div>
    <div className={`mt-1.5 text-xl font-bold tabular-nums ${t}`}>{value}</div>
    {sub && <div className="mt-0.5 text-xs text-slate-400 truncate" title={sub}>{sub}</div>}
  </>);
  // Chỉ thẻ CÓ lọc mới là nút (hover nổi, con trỏ tay); thẻ thông tin là ô tĩnh — không trông như bấm được
  if (!onClick) return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">{body}</div>;
  return (
    <button type="button" onClick={onClick} title="Bấm để lọc danh sách"
      className={`rounded-xl border bg-white px-4 py-3.5 text-left transition hover:shadow-md ${active ? "ring-2 ring-blue-500 border-blue-300" : "border-slate-200"}`}>
      {body}
    </button>
  );
}

/* ---- Nhập / sửa NỢ ĐẦU KỲ (chốt sổ công nợ cũ) của 1 khách ----
   Còn nợ đầu kỳ = Tổng nợ − Đã trả → khoản nợ cũ nhất, Phiếu thanh toán trừ vào đây trước. */
function OpeningDialog({ customers, customerId, opening, onClose, onSaved }) {
  const [f, setF] = useState({
    customer_id: customerId || "", cutoff_date: opening?.cutoff_date?.slice(0, 10) || "2026-09-30",
    total_debt: opening?.total_debt ?? "", paid_before: opening?.paid_before ?? "", note: opening?.note || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const rest = (Number(f.total_debt) || 0) - (Number(f.paid_before) || 0);
  const save = async () => {
    if (!f.customer_id) return toast.error("Vui lòng chọn khách hàng");
    setBusy(true);
    try { const r = await api.saveOpening(f.customer_id, f); toast.success(r.message || "Đã lưu"); onSaved(f.customer_id); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm("Xóa nợ đầu kỳ của khách này? Các phiếu thanh toán sẽ được trừ lại vào phiếu giao.")) return;
    setBusy(true);
    try { const r = await api.removeOpening(f.customer_id); toast.success(r.message || "Đã xóa"); onSaved(f.customer_id); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const lbl = "block text-xs font-medium text-slate-500 mb-1";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <DialogBehavior onClose={onClose} dirty={false} />
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="font-semibold text-slate-800">{opening ? "Sửa nợ đầu kỳ" : "Nhập nợ đầu kỳ"}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-3.5 px-5 py-4 text-sm">
          <div><label className={lbl}>Khách hàng *</label>
            <SearchSelect value={f.customer_id} onChange={(v) => set("customer_id", v)} disabled={!!customerId}
              options={customers.map((c) => ({ value: c.id, label: c.name }))} placeholder="-- Chọn khách hàng --" /></div>
          <div><label className={lbl}>Ngày chốt sổ *</label><DateInput className={inputCls} value={f.cutoff_date} onChange={(e) => set("cutoff_date", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Tổng nợ (đ)</label><MoneyInput value={f.total_debt} onChange={(v) => set("total_debt", v)} placeholder="0" /></div>
            <div><label className={lbl}>Đã trả (đ)</label><MoneyInput value={f.paid_before} onChange={(v) => set("paid_before", v)} placeholder="0" /></div>
          </div>
          <div className={`rounded-lg px-3 py-2 ${rest > 0.005 ? "bg-rose-50 text-rose-700" : rest < -0.005 ? "bg-blue-50 text-blue-700" : "bg-slate-50 text-slate-500"}`}>
            {rest > 0.005 ? <>Còn nợ đầu kỳ: <b>{vnd(rest)} đ</b> — phiếu thanh toán sẽ trừ vào khoản này trước.</>
              : rest < -0.005 ? <>Khách trả dư: <b>{vnd(-rest)} đ</b> — giữ làm tiền trả trước.</> : "Không còn nợ."}
          </div>
          <div><label className={lbl}>Ghi chú</label><input className={inputCls} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="vd: chốt theo sổ tay đến 30/09/2026" /></div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-3">
          {opening && <button onClick={remove} disabled={busy} className="btn-ghost text-rose-600"><Trash2 size={15} /> Xóa</button>}
          <button onClick={onClose} className="btn-ghost ml-auto">Hủy</button>
          <button onClick={save} disabled={busy} className="btn-primary"><Save size={15} /> Lưu</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Chi tiết công nợ 1 khách (ngăn trượt bên phải) ---- */
function DetailDrawer({ customerId, customers, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [loadErr, setLoadErr] = useState(""); const [tryN, setTryN] = useState(0);
  const [editOpening, setEditOpening] = useState(false);
  useEffect(() => { api.detail(customerId).then(setD).catch((e) => setLoadErr(e.message || "Lỗi máy chủ")); }, [customerId, tryN]);
  const op = d?.opening;
  // Xuất sổ công nợ 1 khách: tổng hợp + nợ đầu kỳ + phiếu giao + các lần thanh toán (ngày, số tiền)
  const exportCustomer = () => {
    const aoa = [[`Công nợ khách hàng: ${d.customer_name} (${d.customer_code || ""}) · ngày ${fmtDate(todayYmd())}`], [],
      ["Phải trả (đ)", "Đã trả (đ)", "Còn nợ (đ)", "Trả trước (đ)"],
      [Math.round(d.billed), Math.round(d.paid), Math.round(d.debt), Math.round(d.credit)], []];
    if (op) aoa.push(["NỢ ĐẦU KỲ"], ["Ngày chốt", "Tổng nợ (đ)", "Đã trả (đ)", "Ghi chú"],
      [fmtDate(op.cutoff_date), Math.round(op.total_debt), Math.round(op.paid_before), op.note || ""], []);
    aoa.push(["CÁC LẦN THANH TOÁN"], ["Ngày thanh toán", "Số phiếu", "Hình thức", "Số HĐ", "Người trả", "Số tiền (đ)", "Ghi chú"]);
    const paid = d.receipts.filter((r) => !r.is_cancelled).sort((a, b) => String(a.pay_date).localeCompare(String(b.pay_date)));
    paid.forEach((r) => aoa.push([fmtDate(r.pay_date), r.receipt_code, r.method, r.invoice_no || "", r.payer_name || "", Math.round(r.amount), r.content || ""]));
    aoa.push(["Tổng", "", "", "", "", Math.round(paid.reduce((s, r) => s + Number(r.amount || 0), 0))], []);
    aoa.push(["PHIẾU GIAO HÀNG"], ["Ngày giao", "Số phiếu", "Tổng (đ)", "Đã trả (đ)", "Còn nợ (đ)", "Trạng thái"]);
    [...d.notes].reverse().forEach((n) => aoa.push([fmtDate(n.delivery_date), n.note_code, Math.round(n.total_amount), Math.round(n.paid_amount), Math.round(n.due), n.status]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 15 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Công nợ");
    XLSX.writeFile(wb, `cong-no-${(d.customer_code || d.customer_name || "khach").replace(/[\\/:*?"<>|\s]+/g, "-")}-${todayYmd()}.xlsx`);
  };
  const bad = d?.settings?.bad_days ?? null; // ngưỡng thật từ máy chủ; chưa có → không tô "quá hạn"
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-[640px] bg-white shadow-2xl z-50 flex flex-col">
        <DialogBehavior onClose={onClose} dirty={false} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <div className="text-xs text-slate-400">Công nợ khách hàng</div>
            <div className="text-lg font-bold text-slate-800">{d?.customer_name || "…"}</div>
          </div>
          <div className="flex items-center gap-3">{d && <LevelBadge level={d.level} />}
            {d && <button onClick={exportCustomer} className="btn-ghost !py-1 text-sm" title="Xuất công nợ + các lần thanh toán của khách này"><Download size={14} /> Xuất Excel</button>}<button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button></div>
        </div>
        {!d ? (loadErr ? <div className="p-6"><LoadError message={`Không tải được công nợ (${loadErr})`} onRetry={() => { setLoadErr(""); setTryN((n) => n + 1); }} /></div> : <div className="p-6 text-sm text-slate-400">Đang tải…</div>) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              {[["Phải trả", d.billed, "text-slate-800"], ["Đã trả", d.paid, "text-emerald-700"], ["Còn nợ", d.debt, "text-rose-600"], ["Trả trước", d.credit, "text-blue-700"]].map(([l, v, c]) => (
                <div key={l} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-slate-500 text-xs">{l}</div><div className={`font-bold tabular-nums ${c}`}>{vnd(v)}</div></div>
              ))}
            </div>

            {(op || d.can_edit_amounts) && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold uppercase text-slate-400">Nợ đầu kỳ</div>
                  {d.can_edit_amounts && <button onClick={() => setEditOpening(true)} className="text-xs text-blue-600 hover:underline">{op ? "Sửa" : "+ Nhập nợ đầu kỳ"}</button>}
                </div>
                {op ? (
                  <div className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div><div className="text-xs text-slate-500">Chốt ngày</div><div className="font-medium">{fmtDate(op.cutoff_date)}</div></div>
                    <div><div className="text-xs text-slate-500">Tổng nợ</div><div className="font-medium tabular-nums">{vnd(op.total_debt)}</div></div>
                    <div><div className="text-xs text-slate-500">Đã trả</div><div className="font-medium tabular-nums text-emerald-700">{vnd(op.paid_before)}</div></div>
                    <div><div className="text-xs text-slate-500">{Number(op.excess) > 0.005 ? "Dư chưa trừ" : "Còn nợ"}</div>
                      <div className={`font-semibold tabular-nums ${Number(op.due) > 0.005 ? "text-rose-600" : Number(op.excess) > 0.005 ? "text-blue-700" : "text-slate-300"}`}>{vnd(Number(op.excess) > 0.005 ? op.excess : Math.max(Number(op.due) || 0, 0))}</div></div>
                    {op.note && <div className="col-span-full text-xs text-slate-400">{op.note}</div>}
                  </div>
                ) : <div className="text-xs text-slate-400 italic">Chưa nhập.</div>}
              </div>
            )}

            <div>
              <div className="text-xs font-semibold uppercase text-slate-400 mb-2">Phiếu giao hàng ({d.notes.length})</div>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr><th className="text-left px-3 py-2">Phiếu</th><th className="text-right px-3 py-2">Tổng</th><th className="text-right px-3 py-2">Đã trả</th><th className="text-right px-3 py-2">Còn nợ</th><th className="text-left px-3 py-2">Trạng thái</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.notes.map((n) => {
                      const due = Number(n.due) || 0;
                      const late = bad != null && due > 0.005 && n.age_days > bad;
                      return (
                        <tr key={n.id} className={late ? "bg-rose-50/50" : ""}>
                          <td className="px-3 py-1.5"><div className="font-medium">{n.note_code}</div>
                            <div className={`text-xs ${late ? "text-rose-600 font-medium" : "text-slate-400"}`}>{fmtDate(n.delivery_date)}{due > 0.005 && ` · ${n.age_days} ngày`}{late && " · quá hạn"}</div></td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{vnd(n.total_amount)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{vnd(n.paid_amount)}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${due > 0.005 ? "text-rose-600" : "text-slate-300"}`}>{due > 0.005 ? vnd(due) : "0"}</td>
                          <td className="px-3 py-1.5"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(n.status)}`}>{n.status}</span></td>
                        </tr>
                      );
                    })}
                    {!d.notes.length && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">Chưa có phiếu giao</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase text-slate-400 mb-2">Phiếu thanh toán ({d.receipts.length})</div>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr><th className="text-left px-3 py-2">Phiếu</th><th className="text-left px-3 py-2">Hình thức</th><th className="text-left px-3 py-2">Số HĐ</th><th className="text-right px-3 py-2">Số tiền</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.receipts.map((r) => (
                      <tr key={r.id} className={r.is_cancelled ? "text-slate-400" : ""}>
                        <td className="px-3 py-1.5"><div className="font-medium">{r.receipt_code}{r.is_cancelled && <span className="ml-1 text-xs text-rose-500">(đã hủy)</span>}</div><div className="text-xs text-slate-400">{fmtDate(r.pay_date)}{r.payer_name ? ` · ${r.payer_name}` : ""}</div></td>
                        <td className="px-3 py-1.5">{r.method}</td>
                        <td className="px-3 py-1.5">{r.invoice_no || "—"}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${r.is_cancelled ? "line-through" : "text-emerald-700"}`}>{vnd(r.amount)}</td>
                      </tr>
                    ))}
                    {!d.receipts.length && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Chưa có phiếu thanh toán</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
      {editOpening && <OpeningDialog customers={customers} customerId={customerId} opening={op} onClose={() => setEditOpening(false)}
        onSaved={() => { setEditOpening(false); setD(null); setTryN((n) => n + 1); onChanged?.(); }} />}
    </>
  );
}

export default function ReceivablesModule({ lookups }) {
  const customers = lookups?.customers || [];
  const [newOpening, setNewOpening] = useState(false);
  const { fpermSecret } = usePerm();
  const hidden = fpermSecret("deliveries", "amounts") === "hidden";
  const [rows, setRows] = useState([]);
  const [settings, setSettings] = useState({ bad_days: null, limit_amount: null }); // S-12: chưa tải → "—"
  const badTxt = settings.bad_days ?? "—";
  const limitTxt = settings.limit_amount != null ? vnd(Number(settings.limit_amount)) : "—";
  const [loading, setLoading] = useState(false);
  const [levelView, setLevelView] = useState(""); // "" | debt | bad | blocked
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.list(); setRows(r.data || []); setSettings(r.settings || settings); }
    catch (e) { toast.error("Lỗi tải công nợ: " + e.message); }
    finally { setLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!hidden) load(); }, [load, hidden]);

  if (hidden) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Bạn không có quyền xem công nợ.</div>;

  const sum = (k, list = rows) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const badList = rows.filter((r) => r.is_bad);
  const blockedList = rows.filter((r) => r.over_limit);
  const debtList = rows.filter((r) => r.debt > 0.005);
  const shown = levelView === "debt" ? debtList : levelView === "bad" ? badList : levelView === "blocked" ? blockedList : rows;
  const pick = (v) => setLevelView((cur) => (cur === v ? "" : v));
  // Top 10 nợ xấu cần đòi: tiền quá hạn nhiều nhất trước; bằng nhau thì nợ lâu hơn trước
  const topBad = [...badList].sort((a, b) => b.overdue_debt - a.overdue_debt || b.oldest_days - a.oldest_days).slice(0, 10);
  const exportTopBad = () => {
    const data = topBad.map((r, i) => ({
      "Hạng": i + 1, "Mã KH": r.customer_code, "Khách hàng": r.customer_name, "Điện thoại": r.phone || "",
      [`Nợ quá ${badTxt} ngày (đ)`]: Math.round(r.overdue_debt), "Tổng nợ (đ)": Math.round(r.debt),
      "Nợ lâu nhất (ngày)": r.oldest_days, "Trả gần nhất": r.last_pay ? fmtDate(r.last_pay) : "Chưa trả",
      "Cảnh báo": LEVELS[r.level]?.label, "Người phụ trách đòi": "", "Kết quả / hẹn trả": "",
    }));
    const ws = XLSX.utils.aoa_to_sheet([[`Top ${topBad.length} khách nợ xấu cần đòi · ngày ${fmtDate(todayYmd())}`], []]);
    XLSX.utils.sheet_add_json(ws, data, { origin: "A3" });
    ws["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Đòi nợ");
    XLSX.writeFile(wb, `top-no-xau-${todayYmd()}.xlsx`);
  };

  const columns = [
    { key: "customer_name", label: "Khách hàng", filter: "text", minWidth: "200px",
      render: (r) => <button onClick={() => setOpenId(r.customer_id)} className="text-left font-medium text-blue-600 hover:underline">{r.customer_name}<span className="block text-xs font-normal text-slate-400">{r.customer_code}</span></button> },
    { key: "billed", label: "Phải trả", align: "right", minWidth: "120px", render: (r) => <span className="tabular-nums">{vnd(r.billed)}</span> },
    { key: "paid", label: "Đã trả", align: "right", minWidth: "120px", render: (r) => <span className="tabular-nums text-emerald-700">{vnd(r.paid)}</span> },
    { key: "debt", label: "Còn nợ", align: "right", minWidth: "130px", render: (r) => <span className={`tabular-nums font-bold ${r.debt > 0.005 ? "text-rose-600" : "text-slate-300"}`}>{vnd(r.debt)}</span> },
    { key: "overdue_debt", label: `Nợ quá ${badTxt} ngày`, align: "right", minWidth: "130px", render: (r) => r.overdue_debt > 0.005 ? <span className="tabular-nums font-semibold text-rose-600">{vnd(r.overdue_debt)}</span> : <span className="text-slate-300">—</span> },
    { key: "oldest_days", label: "Nợ lâu nhất", align: "right", minWidth: "100px", render: (r) => r.debt > 0.005 ? <span className={r.oldest_days > settings.bad_days ? "text-rose-600 font-medium" : "text-slate-600"}>{r.oldest_days} ngày</span> : <span className="text-slate-300">—</span> },
    { key: "credit", label: "Trả trước", align: "right", minWidth: "110px", render: (r) => r.credit > 0.005 ? <span className="tabular-nums text-blue-700">{vnd(r.credit)}</span> : <span className="text-slate-300">—</span> },
    { key: "level", label: "Cảnh báo", filter: "select", minWidth: "130px", filterValue: (r) => LEVELS[r.level]?.label, options: Object.values(LEVELS).map((l) => l.label),
      render: (r) => <LevelBadge level={r.level} /> },
  ];

  const exportExcel = async () => {
    if (!shown.length) return toast.error("Danh sách đang trống");
    const data = shown.map((r) => ({
      "Mã KH": r.customer_code, "Khách hàng": r.customer_name, "Phải trả (đ)": Math.round(r.billed), "Đã trả (đ)": Math.round(r.paid),
      "Còn nợ (đ)": Math.round(r.debt), [`Nợ quá ${badTxt} ngày (đ)`]: Math.round(r.overdue_debt),
      "Nợ lâu nhất (ngày)": r.debt > 0.005 ? r.oldest_days : "", "Trả trước (đ)": Math.round(r.credit), "Cảnh báo": LEVELS[r.level]?.label,
    }));
    const ws = XLSX.utils.aoa_to_sheet([[`Báo cáo công nợ · ngày ${fmtDate(todayYmd())}`], []]);
    XLSX.utils.sheet_add_json(ws, data, { origin: "A3" });
    ws["!cols"] = [{ wch: 10 }, { wch: 32 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Công nợ");
    // Sheet 2: các lần thanh toán (ngày + số tiền) của đúng các khách đang hiển thị
    try {
      const ids = new Set(shown.map((r) => r.customer_id));
      const list = ((await paymentReceipts.list()) || []).filter((r) => !r.is_cancelled && ids.has(r.customer_id))
        .sort((a, b) => (a.customer_name || "").localeCompare(b.customer_name || "") || String(a.pay_date).localeCompare(String(b.pay_date)));
      const ws2 = XLSX.utils.json_to_sheet(list.map((r) => ({
        "Mã KH": r.customer_code, "Khách hàng": r.customer_name, "Ngày thanh toán": fmtDate(r.pay_date), "Số phiếu": r.receipt_code,
        "Hình thức": r.method, "Số HĐ": r.invoice_no || "", "Số tiền (đ)": Math.round(r.amount),
      })));
      ws2["!cols"] = [{ wch: 10 }, { wch: 32 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Thanh toán");
    } catch (e) { toast.error("Không tải được danh sách thanh toán: " + e.message); }
    XLSX.writeFile(wb, `cong-no-${todayYmd()}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <ListHeader title="Báo cáo công nợ" actions={<>
        <button onClick={load} disabled={loading} className="btn-ghost"><RotateCcw size={16} className={loading ? "animate-spin" : ""} /> Làm mới</button>
        <button onClick={() => setNewOpening(true)} className="btn-ghost"><Plus size={16} /> Nợ đầu kỳ</button>
        <button onClick={exportExcel} className="btn-primary"><Download size={16} /> Xuất Excel</button>
      </>} />

      {(badList.length > 0 || blockedList.length > 0) && (
        <div className="space-y-2">
          {blockedList.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <Ban size={18} className="mt-0.5 shrink-0" />
              <div><b>{blockedList.length} khách nợ vượt hạn mức {limitTxt} đ — đang bị chặn tạo phiếu giao:</b> {blockedList.map((r) => `${r.customer_name} (${vnd(r.debt)} đ)`).join(", ")}</div>
            </div>
          )}
        </div>
      )}

      {/* Top 10 nợ xấu cần đòi: xếp theo tiền quá hạn (nhiều nhất trước), cùng tiền thì nợ lâu hơn trước */}
      {badList.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-200 text-amber-800">
            <AlertTriangle size={18} className="shrink-0" />
            <span className="font-semibold">Top {topBad.length} khách nợ xấu cần đòi</span>
            <span className="text-sm">· {badList.length} khách có phiếu giao nợ quá {badTxt} ngày · tổng quá hạn <b>{vnd(sum("overdue_debt", badList))} đ</b></span>
            <button onClick={exportTopBad} className="ml-auto btn-ghost !py-1 text-sm"><Download size={14} /> Xuất danh sách</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-center w-10">#</th>
                  <th className="px-3 py-2 text-left">Khách hàng</th>
                  <th className="px-3 py-2 text-left">Điện thoại</th>
                  <th className="px-3 py-2 text-right">Nợ quá hạn</th>
                  <th className="px-3 py-2 text-right">Tổng nợ</th>
                  <th className="px-3 py-2 text-right">Nợ lâu nhất</th>
                  <th className="px-3 py-2 text-left">Trả gần nhất</th>
                  <th className="px-3 py-2 text-left">Cảnh báo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topBad.map((r, i) => (
                  <tr key={r.customer_id} className="hover:bg-amber-50/40">
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600"}`}>{i + 1}</span>
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => setOpenId(r.customer_id)} className="text-left font-medium text-blue-600 hover:underline">{r.customer_name}</button>
                      <div className="text-xs text-slate-400">{r.customer_code}</div>
                    </td>
                    <td className="px-3 py-2">{r.phone ? <a href={`tel:${r.phone}`} className="text-slate-700 hover:text-blue-600">{r.phone}</a> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-600">{vnd(r.overdue_debt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{vnd(r.debt)}</td>
                    <td className="px-3 py-2 text-right font-medium text-rose-600">{r.oldest_days} ngày</td>
                    <td className="px-3 py-2 text-slate-600">{r.last_pay ? fmtDate(r.last_pay) : <span className="text-slate-400">Chưa trả lần nào</span>}</td>
                    <td className="px-3 py-2"><LevelBadge level={r.level} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Card label="Phải trả" value={vnd(sum("billed"))} sub="Tổng tiền phiếu giao đã giao" icon={Receipt} />
        <Card label="Đã trả" value={vnd(sum("paid"))} sub="Tổng phiếu thanh toán" icon={Wallet} tone="emerald" />
        <Card label="Còn nợ" value={vnd(sum("debt"))} sub={`${debtList.length} khách đang nợ`} icon={Users} tone="rose" onClick={() => pick("debt")} active={levelView === "debt"} />
        <Card label={`Nợ quá ${badTxt} ngày`} value={vnd(sum("overdue_debt"))} sub={`${badList.length} khách nợ xấu`} icon={Clock} tone="rose" onClick={() => pick("bad")} active={levelView === "bad"} />
        <Card label="Vượt hạn mức" value={blockedList.length} sub={`Nợ > ${limitTxt} đ`} icon={Ban} tone={blockedList.length ? "rose" : "slate"} onClick={() => pick("blocked")} active={levelView === "blocked"} />
        <Card label="Trả trước" value={vnd(sum("credit"))} sub="Tiền khách trả dư" icon={Wallet} tone="blue" />
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span>{levelView ? `Đang lọc: ${{ debt: "khách đang nợ", bad: "khách nợ xấu", blocked: "khách vượt hạn mức" }[levelView]}` : "Tất cả khách có phát sinh"} · {shown.length} khách</span>
        {levelView && <button onClick={() => setLevelView("")} className="text-blue-600 hover:underline">Bỏ lọc</button>}
        <span className="ml-auto text-xs text-slate-400">Bấm tên khách để xem chi tiết phiếu giao / phiếu thanh toán</span>
      </div>

      <DataTable columns={columns} rows={shown} rowKey={(r) => r.customer_id} loading={loading} emptyText="Không có khách nào" />

      {openId && <DetailDrawer customerId={openId} customers={customers} onClose={() => setOpenId(null)} onChanged={load} />}
      {newOpening && <OpeningDialog customers={customers} onClose={() => setNewOpening(false)}
        onSaved={(cid) => { setNewOpening(false); load(); setOpenId(cid); }} />}
    </div>
  );
}
