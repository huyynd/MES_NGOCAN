import React, { useState, useEffect, useCallback } from "react";
import { ShoppingCart, Factory, Users, AlertTriangle, RotateCcw, TrendingUp, Wallet, Clock, Truck } from "lucide-react";
import { Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { reports } from "../../mesApi.js";
import { fmt, toast } from "../../ui.js";

/* Nhóm tuổi nợ: khóa dữ liệu · nhãn · màu (xanh→vàng→cam→đỏ) */
const AGE = [
  { key: "lt6m", label: "< 6 tháng", color: "#2a78d6" },
  { key: "m6_12", label: "6–12 tháng", color: "#eda100" },
  { key: "y1_2", label: "1–2 năm", color: "#eb6834" },
  { key: "gt2", label: "> 2 năm", color: "#e24b4a" },
];
/* Màu lát bánh: 5 khách top + "Phần khác" (xám) */
const PIE_COLORS = ["#e24b4a", "#2a78d6", "#eda100", "#6250d6", "#1baf7a", "#b4b2a9"];

/* Thẻ chỉ số */
function Metric({ label, value, sub, tone }) {
  const toneCls = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : tone === "accent" ? "text-blue-600" : "text-slate-800";
  return (
    <div className="bg-slate-50 rounded-xl px-4 py-3">
      <div className="text-[13px] text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-semibold leading-tight ${toneCls}`}>{value}</div>
      {sub != null && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/* Dòng thanh ngang (tên · thanh · số) */
function BarRow({ name, value, pct, color }) {
  return (
    <div className="flex items-center gap-3 text-sm py-1.5">
      <span className="flex-[1.1] text-slate-700 truncate">{name}</span>
      <div className="flex-[2] h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
      <span className="w-24 text-right text-slate-500 tabular-nums">{value}</span>
    </div>
  );
}

const money = (v) => (v == null ? "—" : fmt(v) + " đ");

const TABS = [
  { k: "sales", label: "Kinh doanh", icon: ShoppingCart },
  { k: "prod", label: "Sản xuất & NVL", icon: Factory },
  { k: "staff", label: "Nhân sự & hiệu suất", icon: Users },
];

export default function DirectorReport() {
  const [period, setPeriod] = useState("month");
  const [tab, setTab] = useState("sales");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    reports.director(period).then(setData).catch((e) => toast.error("Lỗi tải báo cáo: " + e.message)).finally(() => setLoading(false));
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const s = data?.sales, p = data?.production, w = data?.workforce;
  const showMoney = !!data?.can_view_amounts;
  const maxHour = Math.max(1, ...(w?.top || []).map((x) => x.per_hour));

  return (
    <div className="space-y-5">
      {/* Header: tiêu đề + chọn kỳ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Báo cáo giám đốc</h2>
          {data && <div className="text-sm text-slate-500">Kỳ: {period === "week" ? "Tuần này" : "Tháng này"} · {data.from} → {data.to}</div>}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {[["week", "Tuần"], ["month", "Tháng"]].map(([k, lb]) => (
              <button key={k} onClick={() => setPeriod(k)}
                className={`px-4 py-1.5 text-sm font-medium transition ${period === k ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{lb}</button>
            ))}
          </div>
          <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map(({ k, label, icon: Icon }) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${tab === k ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="text-slate-400 text-sm py-16 text-center">Đang tải báo cáo…</div>
      ) : !data ? null : (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          {/* 1 · Kinh doanh — Công nợ phải thu */}
          {tab === "sales" && (
            !showMoney ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-400 bg-slate-50 rounded-xl px-4 py-12">
                <Wallet size={18} /> Số liệu công nợ / doanh thu chỉ hiển thị cho vai trò quản lý
              </div>
            ) : (() => {
              const r = data.receivables || { total_debt: 0, overdue_amount: 0, intime_amount: 0, overdue_count: 0, customer_count: 0, buckets: {}, by_customer: [] };
              const ovPct = r.total_debt > 0 ? Math.round((r.overdue_amount / r.total_debt) * 100) : 0;
              const pie = [{ name: "Quá hạn", value: r.overdue_amount, color: "#e24b4a" }, { name: "Trong hạn", value: r.intime_amount, color: "#2a78d6" }];
              const bucketTot = AGE.map((a) => r.buckets[a.key] || 0);
              // Top 5 khách hàng + gộp phần còn lại thành "Phần khác"
              const top5 = r.by_customer.slice(0, 5);
              const otherDebt = Math.max(0, r.total_debt - top5.reduce((a, c) => a + c.debt, 0));
              const custPie = [
                ...top5.map((c, i) => ({ name: c.name, value: c.debt, color: PIE_COLORS[i] })),
                ...(otherDebt > 1e-6 ? [{ name: "Phần khác", value: otherDebt, color: PIE_COLORS[5] }] : []),
              ];
              const otherRow = otherDebt > 1e-6
                ? { name: "Phần khác", debt: otherDebt, ...Object.fromEntries(AGE.map((a, i) => [a.key, Math.max(0, bucketTot[i] - top5.reduce((s, c) => s + (c[a.key] || 0), 0))])) }
                : null;
              const tableRows = otherRow ? [...top5, otherRow] : top5;
              return (
                <div className="space-y-6">
                  {/* 4 chỉ số chính */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* 1 · Đơn hàng trong kỳ + doanh thu */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-4">
                      <div className="flex items-center gap-2 text-[13px] text-slate-500 mb-2"><ShoppingCart size={16} className="text-blue-600" /> Đơn hàng {period === "week" ? "trong tuần" : "trong tháng"}</div>
                      <div className="text-3xl font-bold text-slate-800 leading-none">{fmt(s.order_count)}<span className="text-base font-medium text-slate-400"> đơn</span></div>
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="text-xs text-slate-400">Doanh thu</div>
                        <div className="text-lg font-semibold text-blue-700">{money(s.total_value)}</div>
                      </div>
                    </div>
                    {/* 2 · Đơn đã đi */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-4">
                      <div className="flex items-center gap-2 text-[13px] text-slate-500 mb-2"><Truck size={16} className="text-emerald-600" /> Đơn đã đi</div>
                      <div className="text-3xl font-bold text-slate-800 leading-none">{fmt(s.shipped_count)}<span className="text-base font-medium text-slate-400"> / {fmt(s.order_count)} đơn</span></div>
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="text-xs text-slate-400">Giao đủ</div>
                        <div className="text-lg font-semibold text-emerald-600">{fmt(s.fully_count)} đơn <span className="text-xs font-normal text-slate-400">· giá trị {money(s.delivered_value)}</span></div>
                      </div>
                    </div>
                    {/* 3 · Nợ đã thu */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-4">
                      <div className="flex items-center gap-2 text-[13px] text-slate-500 mb-2"><Wallet size={16} className="text-emerald-600" /> Nợ đã thu</div>
                      <div className="text-2xl font-bold text-emerald-600 leading-none">{money(r.collected_total)}</div>
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="text-xs text-slate-400">Trên tổng đã xuất HĐ</div>
                        <div className="text-lg font-semibold text-slate-700">{money(r.billed_total)}</div>
                      </div>
                    </div>
                    {/* 4 · Nợ còn lại (quá hạn + trong hạn) */}
                    <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4">
                      <div className="flex items-center gap-2 text-[13px] text-rose-700/70 mb-2"><AlertTriangle size={16} className="text-rose-600" /> Nợ còn lại</div>
                      <div className="text-2xl font-bold text-rose-700 leading-none">{money(r.total_debt)}</div>
                      <div className="mt-2 h-2 rounded-full overflow-hidden flex bg-white">
                        <div style={{ width: `${r.total_debt > 0 ? (r.overdue_amount / r.total_debt) * 100 : 0}%`, background: "#e24b4a" }} />
                        <div style={{ width: `${r.total_debt > 0 ? (r.intime_amount / r.total_debt) * 100 : 0}%`, background: "#2a78d6" }} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="text-rose-600 font-medium"><span className="inline-block w-2 h-2 rounded-sm align-middle mr-1" style={{ background: "#e24b4a" }} />Quá hạn {money(r.overdue_amount)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs mt-0.5">
                        <span className="text-blue-600 font-medium"><span className="inline-block w-2 h-2 rounded-sm align-middle mr-1" style={{ background: "#2a78d6" }} />Trong hạn {money(r.intime_amount)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Biểu đồ: tuổi nợ theo KH + donut quá hạn */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    <div className="lg:col-span-2">
                      <div className="text-sm font-medium text-slate-700 mb-2">Nợ phải thu theo khách hàng (Top 5 + phần khác)</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                        <ResponsiveContainer width="100%" height={240}>
                          <PieChart>
                            <Pie data={custPie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={92} paddingAngle={2}>
                              {custPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                            </Pie>
                            <Tooltip formatter={(v, n) => [money(v), n]} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-1.5">
                          {custPie.map((e) => {
                            const pctv = r.total_debt > 0 ? Math.round((e.value / r.total_debt) * 100) : 0;
                            return (
                              <div key={e.name} className="flex items-center gap-2 text-sm">
                                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: e.color }} />
                                <span className="flex-1 text-slate-700 truncate" title={e.name}>{e.name}</span>
                                <span className="text-slate-600 tabular-nums">{money(e.value)}</span>
                                <span className="w-9 text-right text-slate-400 tabular-nums">{pctv}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-700 mb-2">Nợ quá hạn</div>
                      <div className="relative">
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie data={pie} dataKey="value" nameKey="name" innerRadius={70} outerRadius={100} paddingAngle={2}>
                              {pie.map((e, i) => <Cell key={i} fill={e.color} />)}
                            </Pie>
                            <Tooltip formatter={(v) => money(v)} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 top-[-24px] flex flex-col items-center justify-center pointer-events-none">
                          <div className="text-2xl font-bold text-rose-600">{ovPct}%</div>
                          <div className="text-xs text-slate-400">quá hạn</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Tổng theo nhóm tuổi nợ */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {AGE.map((a, i) => (
                      <div key={a.key} className="bg-slate-50 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[13px] text-slate-500 mb-1">
                          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: a.color }} /> {a.label}
                        </div>
                        <div className="text-lg font-semibold text-slate-800">{money(bucketTot[i])}</div>
                      </div>
                    ))}
                  </div>

                  {/* Bảng chi tiết công nợ theo khách hàng */}
                  <div>
                    <div className="text-sm font-medium text-slate-700 mb-2">Chi tiết công nợ theo top khách hàng</div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                          <tr>
                            <th className="text-left px-4 py-2.5">Tên khách hàng</th>
                            <th className="text-right px-3 py-2.5">Dư nợ</th>
                            {AGE.map((a) => <th key={a.key} className="text-right px-3 py-2.5">{a.label}</th>)}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {tableRows.length ? tableRows.map((c) => (
                            <tr key={c.name} className={c.name === "Phần khác" ? "text-slate-500" : ""}>
                              <td className="px-4 py-2 font-medium text-slate-800">
                                {c.name !== "Phần khác" && <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-2" style={{ background: custPie.find((p) => p.name === c.name)?.color }} />}
                                {c.name}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-rose-600">{fmt(c.debt)}</td>
                              {AGE.map((a) => <td key={a.key} className="px-3 py-2 text-right text-slate-600">{c[a.key] ? fmt(c[a.key]) : "—"}</td>)}
                            </tr>
                          )) : <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Không có công nợ.</td></tr>}
                        </tbody>
                        {tableRows.length > 0 && (
                          <tfoot>
                            <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-bold text-slate-800">
                              <td className="px-4 py-2.5">TỔNG CỘNG</td>
                              <td className="px-3 py-2.5 text-right text-rose-700">{fmt(r.total_debt)}</td>
                              {bucketTot.map((v, i) => <td key={i} className="px-3 py-2.5 text-right">{fmt(v)}</td>)}
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>

                </div>
              );
            })()
          )}

          {/* 2 · Sản xuất & NVL */}
          {tab === "prod" && (
            <div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="Yêu cầu sản xuất" value={fmt(p.request_count)} sub="lệnh trong kỳ" />
                <Metric label="Đủ NVL" value={fmt(p.enough_count)} tone="good" sub={`/ ${fmt(p.active_count)} lệnh đang mở`} />
                <Metric label="Thiếu NVL" value={fmt(p.short_count)} tone={p.short_count > 0 ? "bad" : "default"} sub="cần bổ sung" />
              </div>
              <div className="mt-5">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-rose-600 mb-2">
                  <AlertTriangle size={15} /> Cảnh báo tồn NVL dưới 1 tấn
                </div>
                {p.low_materials.length ? (
                  p.low_materials.map((m) => (
                    <BarRow key={m.name} name={m.name} value={`${fmt(m.on_hand)} ${m.unit}`} color="#e34948" pct={(m.on_hand / 1000) * 100} />
                  ))
                ) : (
                  <div className="text-sm text-slate-400">Không có NVL (kg) nào dưới 1 tấn.</div>
                )}
                <div className="text-xs text-slate-400 mt-2">Vạch mốc = 1.000 kg. Chỉ xét NVL tính bằng kg.</div>
              </div>
            </div>
          )}

          {/* 3 · Nhân sự & hiệu suất */}
          {tab === "staff" && (
            <div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Metric label="Công nhân trong xưởng" value={fmt(w.worker_count)} sub="đang làm việc" />
                <Metric label="Năng suất trung bình" value={`${fmt(w.avg_per_hour)}`} sub="sản phẩm / giờ" tone="accent" />
                <Metric label="Quán quân" value={w.top[0]?.worker || "—"} sub={w.top[0] ? `${fmt(w.top[0].per_hour)} sp/giờ` : "chưa có dữ liệu"} />
              </div>
              <div className="mt-5">
                <div className="text-[13px] text-slate-500 mb-1.5 flex items-center gap-1.5"><TrendingUp size={15} /> Top năng suất (sản phẩm / giờ)</div>
                {w.top.length ? (
                  w.top.map((x) => <BarRow key={x.worker} name={x.worker} value={fmt(x.per_hour)} color="#6250d6" pct={(x.per_hour / maxHour) * 100} />)
                ) : (
                  <div className="text-sm text-slate-400">Chưa có sản lượng trong kỳ để xếp hạng.</div>
                )}
                <div className="text-xs text-slate-400 mt-2">Giờ công tính theo 8 giờ/ngày có làm việc.</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
