import React, { useState, useCallback } from "react";
import { Search, GitMerge, Package, Warehouse, ShoppingCart, Factory, Clock, ChevronRight } from "lucide-react";
import { PageHeader } from "../../components.jsx";
import { inventory, production } from "../../mesApi.js";
import { fmt, fmtDate, statusClass, toast, fmtDateTime } from "../../ui.js";
import { inputCls } from "../../ui.js";
import { TRX_COLOR, trxIsIn } from "./trxHistory.jsx";

function TimelineItem({ icon: Icon, color, title, subtitle, date, badge }) {
  const colors = {
    blue: { bg: "bg-blue-100", icon: "text-blue-600", line: "bg-blue-200" },
    green: { bg: "bg-emerald-100", icon: "text-emerald-600", line: "bg-emerald-200" },
    rose: { bg: "bg-rose-100", icon: "text-rose-600", line: "bg-rose-200" },
    amber: { bg: "bg-amber-100", icon: "text-amber-600", line: "bg-amber-200" },
    slate: { bg: "bg-slate-100", icon: "text-slate-500", line: "bg-slate-200" },
  };
  const c = colors[color] || colors.slate;
  return (
    <div className="flex gap-4 relative">
      <div className="flex flex-col items-center">
        <div className={`w-10 h-10 rounded-full ${c.bg} flex items-center justify-center shrink-0 z-10`}>
          <Icon size={18} className={c.icon} />
        </div>
        <div className={`w-0.5 flex-1 ${c.line} mt-1`} />
      </div>
      <div className="pb-6 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-slate-800">{title}</div>
            {subtitle && <div className="text-sm text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          {badge && <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${badge.cls}`}>{badge.text}</span>}
        </div>
        {date && <div className="text-xs text-slate-400 mt-1.5 flex items-center gap-1"><Clock size={11} />{date}</div>}
      </div>
    </div>
  );
}

function LotResult({ lot, transactions }) {
  return (
    <div className="space-y-5">
      {/* Product info */}
      {lot && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Thông tin sản phẩm</div>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
              <Package size={24} className="text-blue-500" />
            </div>
            <div>
              <div className="font-bold text-slate-800 text-lg">{lot.product_code}</div>
              <div className="text-slate-600">{lot.product_name}</div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(lot.product_type)}`}>{lot.product_type}</span>
                <span className="text-sm text-slate-500">Lô: <strong className="text-slate-700">{lot.lot_code || lot.lot_order_code}</strong></span>
                <span className="text-sm text-slate-500">Tồn: <strong className="text-slate-700">{fmt(lot.quantity)} {lot.unit}</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Lịch sử lô hàng</div>
        {transactions.length === 0 ? (
          <div className="text-slate-400 text-sm py-4">Không có lịch sử giao dịch cho lô này</div>
        ) : (
          <div>
            {transactions.map((t, i) => (
              <TimelineItem
                key={t.id}
                icon={t.trx_type === "Nhập" ? Package : t.trx_type === "Xuất" ? ShoppingCart : Warehouse}
                color={t.trx_type === "Nhập" ? "green" : t.trx_type === "Xuất" ? "rose" : t.trx_type === "Chuyển kho" ? "blue" : "amber"}
                title={`${t.trx_type === "Chuyển kho" ? (trxIsIn(t) ? "Chuyển đến" : "Chuyển đi") : t.trx_type + " kho"} · ${fmt(t.quantity)} ${t.unit || ""}`}
                subtitle={t.warehouse_name ? `${t.warehouse_name}${t.location_name ? " → " + t.location_name : ""}` : undefined}
                date={fmtDateTime(t.created_at)}
                badge={{ text: t.trx_type, cls: TRX_COLOR[t.trx_type] || "" }}
              />
            ))}
            {/* Final: current stock */}
            {lot && (
              <div className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    <Warehouse size={18} className="text-slate-500" />
                  </div>
                </div>
                <div className="pb-2 flex-1">
                  <div className="font-semibold text-slate-700">Tồn kho hiện tại</div>
                  <div className="text-2xl font-bold text-slate-800 mt-1">{fmt(lot.quantity)} <span className="text-base font-normal text-slate-400">{lot.unit}</span></div>
                  {lot.warehouse_name && <div className="text-sm text-slate-500 mt-0.5">{lot.warehouse_name}{lot.location_name ? " · " + lot.location_name : ""}</div>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* All transactions table */}
      {transactions.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 text-sm font-semibold text-slate-700">
            Chi tiết giao dịch ({transactions.length})
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-2.5 text-left">Thời gian</th>
                <th className="px-4 py-2.5 text-left">Loại</th>
                <th className="px-4 py-2.5 text-right">Số lượng</th>
                <th className="px-4 py-2.5 text-left">Kho / Vị trí</th>
                <th className="px-4 py-2.5 text-left">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transactions.map(t => (
                <tr key={t.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 text-slate-500">{fmtDateTime(t.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${TRX_COLOR[t.trx_type] || "bg-amber-50 text-amber-700"}`}>{t.trx_type}</span>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${trxIsIn(t) ? "text-emerald-600" : "text-rose-600"}`}>
                    {trxIsIn(t) ? "+" : "−"}{fmt(t.quantity)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{t.warehouse_name ? `${t.warehouse_name}${t.location_name ? " · " + t.location_name : ""}` : "—"}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{t.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TraceabilityLot() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { lot, transactions }
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (query) => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    setSearched(true);
    try {
      // Search transactions by lot_code
      const txns = await inventory.transactions({ q: query.trim() });
      const lotTxns = (txns || []).filter(t =>
        (t.lot_code || "").toLowerCase().includes(query.toLowerCase()) ||
        (t.ref_code || "").toLowerCase().includes(query.toLowerCase()) ||
        (t.product_code || "").toLowerCase().includes(query.toLowerCase())
      );

      // Try to find matching stock lot
      let lot = null;
      if (lotTxns.length > 0) {
        const pid = lotTxns[0].product_id;
        // /inventory/tree trả danh sách PHẲNG (mỗi dòng = 1 lô × vị trí) → lọc theo SP + mã lô rồi cộng
        const rows = ((await inventory.tree({ product_id: pid })) || []).filter(r => String(r.product_id) === String(pid));
        const first = rows[0] || lotTxns[0];
        const lotCode = lotTxns[0].lot_code || query.trim();
        const lotRows = rows.filter(r => (r.lot_code || "").toLowerCase() === lotCode.toLowerCase());
        lot = {
          product_code: first.product_code, product_name: first.product_name, product_type: first.product_type,
          lot_code: lotCode, specs: lotRows[0]?.specs, unit: lotRows[0]?.unit || first.unit,
          quantity: lotRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
          warehouse_name: lotRows.length === 1 ? lotRows[0].warehouse_name : lotRows.length > 1 ? `${lotRows.length} vị trí` : undefined,
          location_name: lotRows.length === 1 ? lotRows[0].location_name : undefined,
        };
      }

      setResult({ lot, transactions: lotTxns.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) });
    } catch (e) {
      toast.error("Lỗi tra cứu: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const onKey = (e) => { if (e.key === "Enter") search(q); };

  return (
    <div className="space-y-6">
      <PageHeader title="Truy xuất lô hàng" icon={GitMerge} />

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm text-slate-600 mb-3">
          Nhập mã lô sản xuất, số phiếu, hoặc mã sản phẩm để xem toàn bộ lịch sử từ sản xuất → nhập kho → xuất kho.
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              className={inputCls + " pl-9"}
              placeholder="VD: LSX00007 / L001 / SP001…"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={onKey}
            />
          </div>
          <button
            onClick={() => search(q)}
            disabled={loading || !q.trim()}
            className="btn-primary flex items-center gap-2 px-6"
          >
            <Search size={15} /> {loading ? "Đang tra cứu…" : "Tra cứu"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-12 text-slate-400">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          Đang tra cứu dữ liệu…
        </div>
      )}

      {!loading && searched && result && (
        result.transactions.length > 0 || result.lot
          ? <LotResult lot={result.lot} transactions={result.transactions} />
          : <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400">
              <Search size={40} className="mx-auto mb-3 opacity-30" />
              <div className="font-medium">Không tìm thấy kết quả</div>
              <div className="text-sm mt-1">Thử tìm theo mã lô, mã sản phẩm, hoặc số phiếu khác</div>
            </div>
      )}

      {!searched && (
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-8 text-center">
          <GitMerge size={48} className="mx-auto mb-4 text-blue-300" />
          <div className="text-slate-600 font-medium mb-2">Hệ thống truy xuất nguồn gốc</div>
          <div className="text-sm text-slate-500 max-w-md mx-auto">
            Nhập mã lô để xem toàn bộ hành trình của hàng hóa: từ khi nhập kho, qua các lần xuất nhập, đến vị trí tồn kho hiện tại.
          </div>
        </div>
      )}
    </div>
  );
}
