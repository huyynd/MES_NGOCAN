import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, Plus, Trash2, Pencil, Save, GitBranch, ArrowRight, ArrowDown, X, Copy } from "lucide-react";
import { processes, resource } from "../../mesApi.js";

const bomApi = resource("boms");
import {  inputCls, fmt, statusClass , toast } from "../../ui.js";
import { PageHeader, Section, ListHeader, DataTable, UnitSelect, useSaving } from "../../components.jsx";
import { usePerm } from "../../perm.jsx";

const procApi = processes;

const Field = ({ label, required, children }) => (
  <div><label className="block text-sm font-medium text-slate-600 mb-1.5">{label} {required && <span className="text-rose-500">*</span>}</label>{children}</div>
);

/* ---- Lưu đồ quy trình ---- */
function FlowChart({ steps, pname, mname }) {
  if (!steps.length) return <p className="text-sm text-slate-400">Chưa có bước nào để vẽ lưu đồ.</p>;
  return (
    <div className="flex flex-wrap items-stretch gap-2 overflow-x-auto py-2">
      {steps.map((s, i) => {
        const inputs = (s.inputs || []).map((x) => { const nm = pname(x.material_id); return nm ? `${nm}${x.quantity ? ` (${fmt(x.quantity)}${x.unit ? " " + x.unit : ""})` : ""}` : null; }).filter(Boolean);
        const place = [s.workshop, (s.machine_ids?.length ? s.machine_ids : [s.machine_id]).map(mname).filter(Boolean).join(", "), s.duration_minutes ? `${fmt(s.duration_minutes)} phút` : ""].filter(Boolean).join(" · ");
        return (
          <React.Fragment key={s._k ?? i}>
            <div className="min-w-[210px] flex-1 border border-slate-300 rounded-xl bg-white overflow-hidden">
              <div className="px-3 py-2 bg-blue-600 text-white text-sm font-semibold">Bước {i + 1}: {s.name || "(chưa đặt tên)"}</div>
              <div className="p-3 space-y-2 text-sm">
                {place && <div className="text-xs text-slate-400">{place}</div>}
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                  <div className="text-[11px] text-slate-400">Đầu vào</div>
                  <div className="font-medium text-slate-700">{inputs.length ? inputs.join(", ") : "—"}</div>
                </div>
                <div className="flex justify-center text-slate-300"><ArrowDown size={16} /></div>
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5">
                  <div className="text-[11px] text-emerald-600">Đầu ra</div>
                  <div className="font-medium text-emerald-800">{pname(s.output_product_id) || "—"}</div>
                </div>
                <div className="flex gap-2 text-xs">
                  {s.yield_percent !== "" && s.yield_percent != null && <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">TP {fmt(s.yield_percent)}%</span>}
                  {s.scrap_percent !== "" && s.scrap_percent != null && <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">Phế {fmt(s.scrap_percent)}%</span>}
                </div>
              </div>
            </div>
            {i < steps.length - 1 && <div className="flex items-center text-slate-400 shrink-0"><ArrowRight size={22} /></div>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ---- Form quy trình ---- */
function ProcessForm({ lookups, editId, copyId, onBack, onSaved }) {
  const { can } = usePerm();
  const [editing, setEditing] = useState(!editId);
  const [recCode, setRecCode] = useState(""); // mã bản ghi đang mở (cho câu hỏi xóa)
  const [f, setF] = useState({ name: "", product_id: "", status: "Hoạt động", note: "", linked_bom_id: "" });
  const [steps, setSteps] = useState([]);
  const [seq, setSeq] = useState(1);
  const [bomList, setBomList] = useState([]);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => { bomApi.list({}).then(setBomList).catch((e) => toast.error("Không tải được danh sách định mức — bấm Làm mới: " + e.message)); }, []);

  const products = lookups.products || [];
  const machines = lookups.machines || [];
  const workshops = [...new Set(machines.map((m) => m.factory).filter(Boolean))];
  const machinesOf = (ws) => machines.filter((m) => !ws || m.factory === ws);
  const pname = (id) => products.find((p) => p.id === id)?.product_name;
  const pcode = (id) => products.find((p) => p.id === id)?.product_code;
  const mname = (id) => machines.find((m) => m.id === id)?.name;

  const emptyStep = () => ({ _k: 0, name: "", workshop: "", machine_id: "", machine_ids: [], duration_minutes: "", inputs: [], output_product_id: "", output_quantity: "", output_unit: "", yield_percent: "", scrap_percent: "" });
  const mapStep = (s, i) => ({
    _k: i + 1, name: s.name, workshop: s.workshop || "", machine_id: s.machine_id || "",
    // Nhiều máy (cột machine_ids); quy trình cũ chỉ có 1 máy → hiện máy đó
    machine_ids: Array.isArray(s.machine_ids) && s.machine_ids.length ? s.machine_ids.map(String) : (s.machine_id ? [String(s.machine_id)] : []),
    duration_minutes: s.duration_minutes ?? "",
    inputs: Array.isArray(s.inputs) && s.inputs.length
      ? s.inputs.map((x) => ({ material_id: x.material_id || "", quantity: x.quantity ?? "", unit: x.unit || "" }))
      : (Array.isArray(s.input_product_ids) ? s.input_product_ids.filter(Boolean).map((id) => ({ material_id: id, quantity: "", unit: "" })) : []),
    output_product_id: s.output_product_id || "", output_quantity: s.output_quantity ?? "", output_unit: s.output_unit || "",
    yield_percent: s.yield_percent ?? "", scrap_percent: s.scrap_percent ?? "",
  });

  const loadData = useCallback(() => {
    if (!editId) return;
    procApi.get(editId).then((d) => {
      setRecCode(d.process_code || ""); setF({ name: d.name, product_id: d.product_id || "", status: d.status, note: d.note || "", linked_bom_id: d.linked_bom_id || "" });
      setSteps((d.steps || []).map(mapStep));
      setSeq((d.steps?.length || 0) + 1);
    }).catch((e) => toast.error("Lỗi tải quy trình: " + e.message));
  }, [editId]);
  useEffect(() => { loadData(); }, [loadData]);

  // Sao chép từ quy trình nguồn → bản mới
  useEffect(() => {
    if (editId || !copyId) return;
    procApi.get(copyId).then((d) => {
      setF({ name: (d.name || "") + " (copy)", product_id: d.product_id || "", status: d.status, note: d.note || "", linked_bom_id: "" });
      setSteps((d.steps || []).map(mapStep));
      setSeq((d.steps?.length || 0) + 1);
    }).catch((e) => toast.error("Lỗi tải quy trình nguồn: " + e.message));
  }, [copyId, editId]); // eslint-disable-line

  const addStep = () => { setSteps((a) => [...a, { ...emptyStep(), _k: seq }]); setSeq((s) => s + 1); };
  // E-03: bước đã có tên / NVL → hỏi trước khi xóa
  const rmStep = (k) => {
    const i = steps.findIndex((x) => x._k === k), st = steps[i];
    const nMat = (st?.inputs || []).filter((it) => it.material_id).length;
    if (st && (st.name || nMat) && !confirm(`Xóa Bước ${i + 1}${st.name ? ` – ${st.name}` : ""}${nMat ? ` (kèm ${nMat} NVL)` : ""}?`)) return;
    setSteps((a) => a.filter((x) => x._k !== k));
  };
  const upStep = (k, fld, v) => setSteps((a) => a.map((x) => {
    if (x._k !== k) return x;
    const nx = { ...x, [fld]: v };
    // Chọn TP/BTP đầu ra → tự lấy đơn vị theo sản phẩm
    if (fld === "output_product_id") { const p = products.find((pp) => pp.id === v); if (p) nx.output_unit = p.unit || nx.output_unit || ""; }
    return nx;
  }));
  // Bảng NVL đầu vào [{material_id, quantity, unit}]
  const addInputRow = (k) => setSteps((a) => a.map((x) => (x._k === k ? { ...x, inputs: [...x.inputs, { material_id: "", quantity: "", unit: "" }] } : x)));
  const rmInputRow = (k, idx) => setSteps((a) => a.map((x) => (x._k === k ? { ...x, inputs: x.inputs.filter((_, i) => i !== idx) } : x)));
  const upInput = (k, idx, fld, v) => setSteps((a) => a.map((x) => {
    if (x._k !== k) return x;
    const inputs = x.inputs.map((it, i) => {
      if (i !== idx) return it;
      const ni = { ...it, [fld]: v };
      if (fld === "material_id") { const p = products.find((pp) => pp.id === v); if (p) ni.unit = p.unit || ni.unit || ""; }
      return ni;
    });
    return { ...x, inputs };
  }));
  const totalDuration = steps.reduce((s, x) => s + (Number(x.duration_minutes) || 0), 0);
  // đổi xưởng thì bỏ máy nếu máy không thuộc xưởng mới
  const changeWorkshop = (k, ws) => setSteps((a) => a.map((x) => {
    if (x._k !== k) return x;
    const inWs = (id) => machines.some((m) => String(m.id) === String(id) && (!ws || m.factory === ws));
    return { ...x, workshop: ws, machine_id: inWs(x.machine_id) ? x.machine_id : "", machine_ids: (x.machine_ids || []).filter(inWs) };
  }));

  const [saving, guard] = useSaving();
  const save = async () => {
    if (!f.name) return toast.error("Nhập tên quy trình");
    try {
      const payload = {
        ...f,
        steps: steps.filter((s) => s.name).map((s) => ({
          name: s.name, workshop: s.workshop, machine_ids: s.machine_ids || [], machine_id: (s.machine_ids || [])[0] || null, duration_minutes: s.duration_minutes,
          inputs: (s.inputs || []).filter((it) => it.material_id),
          output_product_id: s.output_product_id, output_quantity: s.output_quantity, output_unit: s.output_unit,
          yield_percent: s.yield_percent, scrap_percent: s.scrap_percent,
        })),
      };
      if (editId) { await procApi.update(editId, payload); toast.success("Đã cập nhật thành công"); loadData(); setEditing(false); }
      else { const created = await procApi.create(payload); toast.success("Đã lưu thành công"); onSaved(created?.id); } // tạo mới → ở lại màn chi tiết của bản ghi vừa tạo
    } catch (e) { toast.error("Lỗi lưu: " + e.message); }
  };
  const del = async () => { if (!confirm(`Xóa quy trình ${recCode}${f.name ? ` – ${f.name}` : ""}?`)) return; try { await procApi.remove(editId); toast.success("Đã xóa thành công"); onSaved(); } catch (e) { toast.error("Lỗi xóa: " + e.message); } };

  return (
    <div className="space-y-5">
      <PageHeader title={!editId ? (copyId ? "Tạo quy trình (sao chép)" : "Tạo quy trình công nghệ") : editing ? "Sửa quy trình" : "Chi tiết quy trình công nghệ"} onBack={onBack}
        actions={editId && !editing ? (<>
          {can("process", "edit") && <button onClick={() => setEditing(true)} className="btn-ghost"><Pencil size={16} /> Sửa</button>}
          {can("process", "delete") && <button onClick={del} className="btn-ghost" style={{ color: "#e11d48" }}><Trash2 size={16} /> Xóa</button>}
        </>) : (<>
          {editId && <button onClick={() => { setEditing(false); loadData(); }} className="btn-ghost">Hủy</button>}
          <button onClick={() => guard(save)} disabled={saving} className="btn-primary"><Save size={16} /> {saving ? "Đang lưu…" : "Lưu quy trình"}</button>
        </>)} />

      <fieldset disabled={!editing} className="space-y-5">
        <Section title="Thông tin chung">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            <Field label="Tên quy trình" required><input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="vd: Quy trình túi HD" /></Field>
            <Field label="Thành phẩm cuối">
              <select className={inputCls} value={f.product_id} onChange={(e) => set("product_id", e.target.value)}>
                <option value="">-- Chọn --</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.product_code} · {p.product_name}</option>)}
              </select>
            </Field>
            <Field label="Trạng thái"><select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}><option>Hoạt động</option><option>Không hoạt động</option></select></Field>
            <Field label="Ghi chú"><input className={inputCls} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
            <Field label={<span className="inline-flex items-center gap-1.5"><GitBranch size={14} className="text-blue-500" /> Gắn Định mức (BOM)</span>}>
              <select className={inputCls} value={f.linked_bom_id} onChange={(e) => set("linked_bom_id", e.target.value)}>
                <option value="">-- Không gắn --</option>
                {bomList.map((bm) => <option key={bm.id} value={bm.id}>{bm.bom_code} · {bm.name}</option>)}
              </select>
              <div className="text-[11px] text-slate-400 mt-1">NVL + số lượng của các bước sẽ ghi vào định mức này (định mức thành chỉ-xem).</div>
            </Field>
          </div>
        </Section>

        <Section title={<span className="flex items-center gap-2">Các bước công đoạn
          {totalDuration > 0 && <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Tổng thời gian SX: {fmt(totalDuration)} phút</span>}</span>}
          action={<button onClick={addStep} className="btn-ghost text-blue-600 border-blue-200 hover:bg-blue-50"><Plus size={16} /> Thêm bước</button>}>
          <div className="space-y-4">
            {steps.map((s, i) => (
              <div key={s._k} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                  <span className="font-semibold text-slate-700 text-sm">Bước {i + 1}</span>
                  <button onClick={() => rmStep(s._k)} className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={16} /></button>
                </div>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
                    <div className="md:col-span-4">
                      <Field label="Công đoạn">
                        <input className={inputCls} value={s.name} placeholder="VD: Thổi màng…" onChange={(e) => upStep(s._k, "name", e.target.value)} />
                      </Field>
                    </div>
                    <div className="md:col-span-3">
                      <Field label="Thời gian SX (phút)">
                        <input type="number" min="0" className={inputCls} value={s.duration_minutes} placeholder="0" onChange={(e) => upStep(s._k, "duration_minutes", e.target.value)} />
                      </Field>
                    </div>
                    <div className="md:col-span-5">
                      <Field label="Máy thực hiện (có thể chọn nhiều)">
                        <div className="flex flex-col gap-2">
                          <select className={inputCls} value="" onChange={(e) => {
                            if (!e.target.value) return;
                            const v = e.target.value;
                            let curr = s.machine_ids || [];
                            if (!curr.includes(v)) {
                              upStep(s._k, "machine_ids", [...curr, v]);
                            }
                          }}>
                            <option value="">+ Chọn máy…</option>
                            {machines.filter((m) => !(s.machine_ids || []).includes(m.id)).map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.factory ? `[${m.factory}] ` : ""}{m.name}{m.machine_type ? ` · ${m.machine_type}` : ""}
                              </option>
                            ))}
                          </select>
                          <div className="flex flex-wrap gap-1.5">
                            {!(s.machine_ids && s.machine_ids.length > 0) ? (
                              <span className="text-slate-400 text-[13px] py-1">Chưa chọn máy nào</span>
                            ) : (
                              (s.machine_ids || []).map((mid, idx) => {
                                const m = machines.find((x) => x.id == mid) || { name: `ID: ${mid}` };
                                return (
                                  <div key={idx} className="flex items-center gap-1 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs font-medium border border-blue-100">
                                    <span>{m.factory ? `[${m.factory}] ` : ""}{m.name}</span>
                                    <button onClick={() => upStep(s._k, "machine_ids", (s.machine_ids || []).filter((x) => x != mid))} className="text-blue-400 hover:text-red-500 ml-0.5">&times;</button>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </Field>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-slate-600">NVL / BTP đầu vào</span>
                      <button onClick={() => addInputRow(s._k)} className="text-blue-600 text-xs font-medium hover:underline flex items-center gap-1"><Plus size={13} /> Thêm NVL</button>
                    </div>
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                          <tr><th className="text-left px-3 py-2">Nguyên vật liệu</th><th className="text-right px-3 py-2 w-28">Số lượng</th><th className="text-left px-3 py-2 w-20">Đơn vị</th><th className="w-8" /></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {s.inputs.map((it, idx) => (
                            <tr key={idx}>
                              <td className="px-3 py-1.5">
                                <select className={inputCls} value={it.material_id} onChange={(e) => upInput(s._k, idx, "material_id", e.target.value)}>
                                  <option value="">-- Chọn NVL/BTP --</option>
                                  {products.map((p) => <option key={p.id} value={p.id}>{p.product_code} · {p.product_name}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-1.5"><input type="number" min="0" className={inputCls + " text-right"} value={it.quantity} onChange={(e) => upInput(s._k, idx, "quantity", e.target.value)} /></td>
                              <td className="px-3 py-1.5"><UnitSelect value={it.unit} onChange={(v) => upInput(s._k, idx, "unit", v)} /></td>
                              <td className="px-3 py-1.5 text-center"><button onClick={() => rmInputRow(s._k, idx)} className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={15} /></button></td>
                            </tr>
                          ))}
                          {!s.inputs.length && <tr><td colSpan={4} className="px-3 py-3 text-center text-slate-400 text-xs">Chưa có NVL. Bấm "Thêm NVL".</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Đầu ra + tính SL thực tế */}
                  <div className="rounded-lg bg-emerald-50/50 border border-emerald-100 p-3">
                    <div className="text-sm font-medium text-slate-600 mb-2">TP / BTP đầu ra</div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="col-span-2 md:col-span-2"><Field label="Sản phẩm đầu ra">
                        <select className={inputCls} value={s.output_product_id} onChange={(e) => upStep(s._k, "output_product_id", e.target.value)}>
                          <option value="">-- Chọn --</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.product_code} · {p.product_name}</option>)}
                        </select>
                      </Field></div>
                      <Field label="SL đầu ra ước tính"><input type="number" min="0" className={inputCls} value={s.output_quantity} placeholder="0" onChange={(e) => upStep(s._k, "output_quantity", e.target.value)} /></Field>
                      <Field label="Đơn vị"><UnitSelect value={s.output_unit} onChange={(v) => upStep(s._k, "output_unit", v)} /></Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="% TP"><input type="number" min="0" className={inputCls} value={s.yield_percent} placeholder="0" onChange={(e) => upStep(s._k, "yield_percent", e.target.value)} /></Field>
                        <Field label="% Phế"><input type="number" min="0" className={inputCls} value={s.scrap_percent} placeholder="0" onChange={(e) => upStep(s._k, "scrap_percent", e.target.value)} /></Field>
                      </div>
                    </div>
                    {(Number(s.output_quantity) > 0) && (
                      <div className="flex flex-wrap gap-4 mt-2 text-sm">
                        <span className="text-slate-500">SL thực tế:</span>
                        <span className="font-semibold text-emerald-700">TP {fmt(Number(s.output_quantity) * (Number(s.yield_percent) || 0) / 100)} {s.output_unit}</span>
                        <span className="font-semibold text-rose-600">Phế {fmt(Number(s.output_quantity) * (Number(s.scrap_percent) || 0) / 100)} {s.output_unit}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!steps.length && <div className="py-6 text-center text-slate-400 text-sm">Chưa có bước. Bấm "Thêm bước".</div>}
          </div>
        </Section>
      </fieldset>

      <Section title={<span className="flex items-center gap-2"><GitBranch size={16} className="text-blue-500" /> Lưu đồ quy trình</span>}>
        <FlowChart steps={steps} pname={pname} mname={mname} />
      </Section>
    </div>
  );
}

/* ---- Module chính ---- */
export default function ProcessModule({ lookups }) {
  const { can } = usePerm();
  const [view, setView] = useState("list");
  const [editId, setEditId] = useState(null);
  const [copyId, setCopyId] = useState(null);
  const [rows, setRows] = useState([]);
  const openForm = ({ edit = null, copy = null } = {}) => { setEditId(edit); setCopyId(copy); setView("form"); };
  const [listLoading, setListLoading] = useState(true);
  const load = useCallback(async () => { setListLoading(true); try { setRows(await procApi.list({})); } catch (e) { toast.error("Lỗi tải quy trình: " + e.message); } finally { setListLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const del = async (id) => { const r = rows.find((x) => x.id === id); if (!confirm(`Xóa quy trình ${r?.process_code || ""}${r?.name ? ` – ${r.name}` : ""}?`)) return; try { await procApi.remove(id); toast.success("Đã xóa thành công"); load(); } catch (e) { toast.error("Lỗi xóa: " + e.message); } };

  if (view === "form") return <ProcessForm key={editId || "new"} lookups={lookups} editId={editId} copyId={copyId} onBack={() => { setView("list"); setEditId(null); setCopyId(null); }} onSaved={(newId) => { if (newId) { setEditId(newId); setCopyId(null); } else { setView("list"); setEditId(null); setCopyId(null); } load(); }} />;

  const columns = [
    { key: "process_code", label: "Mã", filter: "text", render: (r) => <button onClick={() => openForm({ edit: r.id })} className="font-medium text-blue-600 hover:underline">{r.process_code}</button> },
    { key: "name", label: "Tên quy trình", filter: "text", tdClass: "text-slate-800" },
    { key: "product_name", label: "Thành phẩm", filter: "select", tdClass: "text-slate-600", render: (r) => r.product_name || "—" },
    { key: "step_count", label: "Số bước", align: "center" },
    { key: "status", label: "Trạng thái", filter: "select", render: (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span> },
    { key: "_act", label: "", align: "right", render: (r) => (<>
        {can("process", "create") && <button onClick={() => openForm({ copy: r.id })} title="Sao chép" className="text-slate-400 hover:text-blue-600 p-1"><Copy size={15} /></button>}
        {can("process", "delete") && <button onClick={() => del(r.id)} title="Xóa" className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={15} /></button>}
      </>) },
  ];

  return (
    <div className="space-y-5">
      <ListHeader title="Quy trình công nghệ" actions={<>
        <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        {can("process", "create") && <button onClick={() => openForm({})} className="btn-primary"><Plus size={16} /> Tạo quy trình</button>}
      </>} />
      <DataTable loading={listLoading} columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Chưa có quy trình" />
    </div>
  );
}
