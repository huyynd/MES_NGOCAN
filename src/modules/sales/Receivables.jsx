// src/modules/sales/Receivables.jsx — BÁO CÁO CÔNG NỢ theo khách hàng
//   Phải trả  = tổng tiền các phiếu giao đã giao      Đã trả = tổng Phiếu thanh toán (+ lần thu cũ)
//   Còn nợ    = phải trả − phần đã trừ                Trả trước = tiền thanh toán dư chưa trừ
//   Nợ xấu    = có phiếu giao còn nợ quá N ngày (app_settings.debt_bad_days, mặc định 30) → cảnh báo
//   Vượt hạn mức = nợ > app_settings.debt_limit_amount (mặc định 300 triệu) → không cho tạo phiếu giao mới
import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, Download, X, AlertTriangle, Ban, Wallet, Users, Receipt, Clock } from "lucide-react";
import * as XLSX from "xlsx";
import { receivables as api } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import { fmtDate, statusClass, toast, todayYmd } from "../../ui.js";
import { ListHeader, DataTable } from "../../components.jsx";
import { LevelBadge, LEVELS, vnd } from "./debtUi.jsx";

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

/* ---- Chi tiết công nợ 1 khách (ngăn trượt bên phải) ---- */
function DetailDrawer({ customerId, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.detail(customerId).then(setD).catch((e) => toast.error(e.message)); }, [customerId]);
  const bad = d?.settings?.bad_days ?? 30;
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-[640px] bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <div className="text-xs text-slate-400">Công nợ khách hàng</div>
            <div className="text-lg font-bold text-slate-800">{d?.customer_name || "…"}</div>
          </div>
          <div className="flex items-center gap-3">{d && <LevelBadge level={d.level} />}<button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={18} /></button></div>
        </div>
        {!d ? <div className="p-6 text-sm text-slate-400">Đang tải…</div> : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              {[["Phải trả", d.billed, "text-slate-800"], ["Đã trả", d.paid, "text-emerald-700"], ["Còn nợ", d.debt, "text-rose-600"], ["Trả trước", d.credit, "text-blue-700"]].map(([l, v, c]) => (
                <div key={l} className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-slate-500 text-xs">{l}</div><div className={`font-bold tabular-nums ${c}`}>{vnd(v)}</div></div>
              ))}
            </div>

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
                      const late = due > 0.005 && n.age_days > bad;
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
    </>
  );
}

export default function ReceivablesModule() {
  const { fpermSecret } = usePerm();
  const hidden = fpermSecret("deliveries", "amounts") === "hidden";
  const [rows, setRows] = useState([]);
  const [settings, setSettings] = useState({ bad_days: 30, limit_amount: 300000000 });
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
      [`Nợ quá ${settings.bad_days} ngày (đ)`]: Math.round(r.overdue_debt), "Tổng nợ (đ)": Math.round(r.debt),
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
    { key: "overdue_debt", label: `Nợ quá ${settings.bad_days} ngày`, align: "right", minWidth: "130px", render: (r) => r.overdue_debt > 0.005 ? <span className="tabular-nums font-semibold text-rose-600">{vnd(r.overdue_debt)}</span> : <span className="text-slate-300">—</span> },
    { key: "oldest_days", label: "Nợ lâu nhất", align: "right", minWidth: "100px", render: (r) => r.debt > 0.005 ? <span className={r.oldest_days > settings.bad_days ? "text-rose-600 font-medium" : "text-slate-600"}>{r.oldest_days} ngày</span> : <span className="text-slate-300">—</span> },
    { key: "credit", label: "Trả trước", align: "right", minWidth: "110px", render: (r) => r.credit > 0.005 ? <span className="tabular-nums text-blue-700">{vnd(r.credit)}</span> : <span className="text-slate-300">—</span> },
    { key: "level", label: "Cảnh báo", filter: "select", minWidth: "130px", filterValue: (r) => LEVELS[r.level]?.label, options: Object.values(LEVELS).map((l) => l.label),
      render: (r) => <LevelBadge level={r.level} /> },
  ];

  const exportExcel = () => {
    if (!shown.length) return toast.error("Danh sách đang trống");
    const data = shown.map((r) => ({
      "Mã KH": r.customer_code, "Khách hàng": r.customer_name, "Phải trả (đ)": Math.round(r.billed), "Đã trả (đ)": Math.round(r.paid),
      "Còn nợ (đ)": Math.round(r.debt), [`Nợ quá ${settings.bad_days} ngày (đ)`]: Math.round(r.overdue_debt),
      "Nợ lâu nhất (ngày)": r.debt > 0.005 ? r.oldest_days : "", "Trả trước (đ)": Math.round(r.credit), "Cảnh báo": LEVELS[r.level]?.label,
    }));
    const ws = XLSX.utils.aoa_to_sheet([[`Báo cáo công nợ · ngày ${fmtDate(todayYmd())}`], []]);
    XLSX.utils.sheet_add_json(ws, data, { origin: "A3" });
    ws["!cols"] = [{ wch: 10 }, { wch: 32 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Công nợ");
    XLSX.writeFile(wb, `cong-no-${todayYmd()}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <ListHeader title="Báo cáo công nợ" actions={<>
        <button onClick={load} disabled={loading} className="btn-ghost"><RotateCcw size={16} className={loading ? "animate-spin" : ""} /> Làm mới</button>
        <button onClick={exportExcel} className="btn-primary"><Download size={16} /> Xuất Excel</button>
      </>} />

      {(badList.length > 0 || blockedList.length > 0) && (
        <div className="space-y-2">
          {blockedList.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <Ban size={18} className="mt-0.5 shrink-0" />
              <div><b>{blockedList.length} khách nợ vượt hạn mức {vnd(settings.limit_amount)} đ — đang bị chặn tạo phiếu giao:</b> {blockedList.map((r) => `${r.customer_name} (${vnd(r.debt)} đ)`).join(", ")}</div>
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
            <span className="text-sm">· {badList.length} khách có phiếu giao nợ quá {settings.bad_days} ngày · tổng quá hạn <b>{vnd(sum("overdue_debt", badList))} đ</b></span>
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
        <Card label={`Nợ quá ${settings.bad_days} ngày`} value={vnd(sum("overdue_debt"))} sub={`${badList.length} khách nợ xấu`} icon={Clock} tone="rose" onClick={() => pick("bad")} active={levelView === "bad"} />
        <Card label="Vượt hạn mức" value={blockedList.length} sub={`Nợ > ${vnd(settings.limit_amount)} đ`} icon={Ban} tone={blockedList.length ? "rose" : "slate"} onClick={() => pick("blocked")} active={levelView === "blocked"} />
        <Card label="Trả trước" value={vnd(sum("credit"))} sub="Tiền khách trả dư" icon={Wallet} tone="blue" />
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span>{levelView ? `Đang lọc: ${{ debt: "khách đang nợ", bad: "khách nợ xấu", blocked: "khách vượt hạn mức" }[levelView]}` : "Tất cả khách có phát sinh"} · {shown.length} khách</span>
        {levelView && <button onClick={() => setLevelView("")} className="text-blue-600 hover:underline">Bỏ lọc</button>}
        <span className="ml-auto text-xs text-slate-400">Bấm tên khách để xem chi tiết phiếu giao / phiếu thanh toán</span>
      </div>

      <DataTable columns={columns} rows={shown} rowKey={(r) => r.customer_id} emptyText={loading ? "Đang tải…" : "Không có khách nào"} />

      {openId && <DetailDrawer customerId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
