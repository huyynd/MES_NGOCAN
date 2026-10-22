import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, Plus, Trash2, Pencil, ArrowLeft, Save, FlaskConical, Copy, GitBranch } from "lucide-react";
import { resource } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import {  inputCls, fmt, statusClass , toast } from "../../ui.js";
import { PageHeader, Section, ListHeader, DataTable, UnitSelect, useSaving } from "../../components.jsx";

const bomApi = resource("boms");
const procApi = resource("processes");
const BOM_TYPES = ["Định mức NVL", "Công thức pha màu"];

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
  </div>
);

/* ---- Form định mức ---- */
function BomForm({ lookups, editId, copyId, onBack, onSaved }) {
  const { can, fperm } = usePerm();
  const fhid = (k) => fperm("bom", k) === "hidden";
  const fdis = (k) => fperm("bom", k) !== "edit";
  const unitOf = (id) => (lookups.products.find((p) => p.id === id)?.unit) || "";
  const typesOf = (p) => (p.product_types && p.product_types.length ? p.product_types : (p.product_type ? [p.product_type] : []));
  const hasType = (p, list) => typesOf(p).some((t) => list.includes(t));
  const outputs = lookups.products.filter((p) => hasType(p, ["Thành phẩm", "Bán thành phẩm"]));
  const materials = lookups.products.filter((p) => hasType(p, ["Nguyên vật liệu", "Bán thành phẩm"]));

  const [f, setF] = useState({
    product_id: "", name: "", bom_type: "Định mức NVL",
    output_quantity: 1, output_unit: "", status: "Hoạt động", note: "", process_id: "",
  });
  const [lines, setLines] = useState([{ _k: 1, material_id: "", quantity: "", unit: "", ratio_percent: "", note: "" }]);
  const [seq, setSeq] = useState(2);
  const [editing, setEditing] = useState(!editId); // tạo mới = sửa ngay; mở sẵn = xem
  const [procList, setProcList] = useState([]);
  const isLinked = !!f.process_id; // đã gắn Quy trình → dòng NVL lấy từ quy trình (khóa)
  const [recCode, setRecCode] = useState(""); // mã bản ghi đang mở (cho câu hỏi xóa)
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => { procApi.list({}).then(setProcList).catch((e) => toast.error("Không tải được danh sách quy trình — bấm Làm mới: " + e.message)); }, []);

  const loadData = useCallback(() => {
    if (!editId) return;
    bomApi.get(editId).then((d) => {
      setRecCode(d.bom_code || ""); setF({ product_id: d.product_id, name: d.name, bom_type: d.bom_type,
        output_quantity: d.output_quantity, output_unit: d.output_unit || unitOf(d.product_id), status: d.status, note: d.note || "", process_id: d.process_id || "" });
      setLines((d.lines || []).map((l, i) => ({
        _k: i + 1, material_id: l.material_id, quantity: l.quantity, unit: l.unit || unitOf(l.material_id),
        ratio_percent: l.ratio_percent ?? "", note: l.note || "" })));
      setSeq((d.lines?.length || 0) + 1);
    }).catch((e) => toast.error("Lỗi tải định mức: " + e.message));
  }, [editId]);
  useEffect(() => { loadData(); }, [loadData]);

  // Sao chép từ định mức nguồn → bản mới
  useEffect(() => {
    if (editId || !copyId) return;
    bomApi.get(copyId).then((d) => {
      setF({ product_id: d.product_id, name: (d.name || "") + " (copy)", bom_type: d.bom_type,
        output_quantity: d.output_quantity, output_unit: d.output_unit || unitOf(d.product_id), status: d.status, note: d.note || "", process_id: "" });
      setLines((d.lines || []).map((l, i) => ({ _k: i + 1, material_id: l.material_id, quantity: l.quantity, unit: l.unit || unitOf(l.material_id), ratio_percent: l.ratio_percent ?? "", note: l.note || "" })));
      setSeq((d.lines?.length || 0) + 1);
    }).catch((e) => toast.error("Lỗi tải định mức nguồn: " + e.message));
  }, [copyId, editId]); // eslint-disable-line

  const addLine = () => { setLines((a) => [...a, { _k: seq, material_id: "", quantity: "", unit: "", ratio_percent: "", note: "" }]); setSeq((s) => s + 1); };
  const rmLine = (k) => setLines((a) => a.filter((x) => x._k !== k));
  const upLine = (k, field, v) => setLines((a) => a.map((x) => {
    if (x._k !== k) return x;
    const nx = { ...x, [field]: v };
    // Chọn nguyên liệu → tự lấy đơn vị theo sản phẩm
    if (field === "material_id") { const p = lookups.products.find((pp) => pp.id === v); if (p) nx.unit = p.unit || ""; }
    return nx;
  }));

  const isColor = f.bom_type === "Công thức pha màu";
  const ratioSum = lines.reduce((s, l) => s + (Number(l.ratio_percent) || 0), 0);

  const [saving, guard] = useSaving();
  const save = async () => {
    if (!f.product_id) return toast.error("Chọn sản phẩm đầu ra");
    if (!f.name) return toast.error("Nhập tên định mức");
    const payload = { ...f, lines: lines.filter((l) => l.material_id) };
    try {
      if (editId) {
        await bomApi.update(editId, payload);
        toast.success("Đã lưu thành công");
        setEditing(false); loadData(); // ở lại màn chi tiết
      } else {
        const created = await bomApi.create(payload);
        toast.success("Đã lưu thành công"); onSaved(created?.id); // tạo mới → ở lại màn chi tiết của bản ghi vừa tạo
      }
    } catch (e) { toast.error("Lỗi lưu định mức: " + e.message); }
  };

  const del = async () => {
    if (!confirm(`Xóa định mức ${recCode}${f.name ? ` – ${f.name}` : ""}?`)) return;
    try { await bomApi.remove(editId); toast.success("Đã xóa thành công"); onSaved(); } catch (e) { toast.error("Lỗi xóa: " + e.message); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={!editId ? (copyId ? "Tạo định mức (sao chép)" : "Tạo định mức / công thức") : editing ? "Sửa định mức / công thức" : "Chi tiết định mức / công thức"} onBack={onBack}
        actions={editId && !editing ? (<>
          {can("bom", "edit") && <button onClick={() => setEditing(true)} className="btn-ghost"><Pencil size={16} /> Sửa</button>}
          {can("bom", "delete") && <button onClick={del} className="btn-ghost" style={{ color: "#e11d48" }}><Trash2 size={16} /> Xóa</button>}
        </>) : (<>
          {editId && <button onClick={() => { setEditing(false); loadData(); }} className="btn-ghost">Hủy</button>}
          <button onClick={() => guard(save)} disabled={saving} className="btn-primary"><Save size={16} /> {saving ? "Đang lưu…" : "Lưu định mức"}</button>
        </>)} />

      {isLinked && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
          <GitBranch size={16} className="shrink-0" />
          <span>Định mức này đang <b>gắn với Quy trình công nghệ</b> — dòng NVL & số lượng <b>lấy từ quy trình</b> (chỉ xem). Bỏ chọn quy trình ở ô "Gắn Quy trình CN" nếu muốn nhập tay.</span>
        </div>
      )}

      <fieldset disabled={!editing} className="space-y-5">

      <Section title="Thông tin chung">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          {!fhid("product_id") && <Field label="Sản phẩm đầu ra" required>
            <select className={inputCls} disabled={fdis("product_id")} value={f.product_id}
              onChange={(e) => { const id = e.target.value; const p = lookups.products.find((pp) => pp.id === id); setF((s) => ({ ...s, product_id: id, output_unit: p?.unit || s.output_unit })); }}>
              <option value="">-- Chọn TP / BTP --</option>
              {outputs.map((p) => <option key={p.id} value={p.id}>{p.product_code} · {p.product_name}</option>)}
            </select>
          </Field>}
          {!fhid("bom_type") && <Field label="Loại định mức" required>
            <select className={inputCls} disabled={fdis("bom_type")} value={f.bom_type} onChange={(e) => set("bom_type", e.target.value)}>
              {BOM_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>}
          {!fhid("name") && <Field label="Tên định mức" required>
            <input className={inputCls} disabled={fdis("name")} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="vd: Công thức pha màu Trắng sữa" />
          </Field>}
          <div className="grid grid-cols-2 gap-3">
            {!fhid("output_quantity") && <Field label="Định mức cho SL"><input type="number" min="0" className={inputCls} disabled={fdis("output_quantity")} value={f.output_quantity} onChange={(e) => set("output_quantity", e.target.value)} /></Field>}
            <Field label="Đơn vị"><UnitSelect value={f.output_unit} onChange={(v) => set("output_unit", v)} /></Field>
          </div>
          <Field label="Trạng thái">
            <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option>Hoạt động</option><option>Không hoạt động</option>
            </select>
          </Field>
          <Field label="Ghi chú"><input className={inputCls} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
          <Field label={<span className="inline-flex items-center gap-1.5"><GitBranch size={14} className="text-blue-500" /> Gắn Quy trình CN</span>}>
            <select className={inputCls} value={f.process_id} onChange={(e) => set("process_id", e.target.value)}>
              <option value="">-- Không gắn (nhập tay) --</option>
              {procList.map((p) => <option key={p.id} value={p.id}>{p.process_code} · {p.name}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      {!fhid("lines") && (
      <Section
        title={<span className="flex items-center gap-2">{isColor && <FlaskConical size={16} className="text-blue-500" />}{isColor ? "Thành phần pha (NVL / phụ gia)" : "Nguyên liệu / bán thành phẩm đầu vào"}
          {isLinked && <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">lấy từ Quy trình CN</span>}</span>}
        action={!fdis("lines") && !isLinked && <button onClick={addLine} className="btn-ghost text-blue-600 border-blue-200 hover:bg-blue-50"><Plus size={16} /> Thêm dòng</button>}>
        <fieldset disabled={fdis("lines") || isLinked}>
        <table className="w-full text-sm">
          <thead className="text-slate-400 text-xs uppercase">
            <tr>
              <th className="text-left py-2 font-medium">Nguyên liệu</th>
              <th className="text-left py-2 font-medium w-24">Số lượng</th>
              <th className="text-left py-2 font-medium w-20">Đơn vị</th>
              {isColor && <th className="text-left py-2 font-medium w-20">Tỷ lệ %</th>}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l._k}>
                <td className="py-1.5 pr-2">
                  <select className={inputCls} value={l.material_id} onChange={(e) => upLine(l._k, "material_id", e.target.value)}>
                    <option value="">-- Chọn NVL/BTP --</option>
                    {materials.map((m) => <option key={m.id} value={m.id}>{m.product_code} · {m.product_name}</option>)}
                  </select>
                </td>
                <td className="py-1.5 pr-2"><input type="number" min="0" className={inputCls} value={l.quantity} onChange={(e) => upLine(l._k, "quantity", e.target.value)} /></td>
                <td className="py-1.5 pr-2"><UnitSelect value={l.unit} onChange={(v) => upLine(l._k, "unit", v)} /></td>
                {isColor && <td className="py-1.5 pr-2"><input type="number" min="0" className={inputCls} value={l.ratio_percent} onChange={(e) => upLine(l._k, "ratio_percent", e.target.value)} /></td>}
                <td className="py-1.5 text-center">
                  <button onClick={() => rmLine(l._k)} className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isColor && (
          <div className={`mt-3 text-sm font-medium ${Math.abs(ratioSum - 100) < 0.01 ? "text-emerald-600" : "text-amber-600"}`}>
            Tổng tỷ lệ: {ratioSum}% {Math.abs(ratioSum - 100) < 0.01 ? "✓" : "(nên = 100%)"}
          </div>
        )}
        </fieldset>
      </Section>
      )}
      </fieldset>
    </div>
  );
}

/* ---- Module chính ---- */
export default function BomModule({ lookups }) {
  const { can } = usePerm();
  const [view, setView] = useState("list");
  const [editId, setEditId] = useState(null);
  const [copyId, setCopyId] = useState(null);
  const [rows, setRows] = useState([]);
  const openForm = ({ edit = null, copy = null } = {}) => { setEditId(edit); setCopyId(copy); setView("form"); };

  const [listLoading, setListLoading] = useState(true);
  const load = useCallback(async () => {
    setListLoading(true); try { setRows(await bomApi.list({})); } catch (e) { toast.error("Lỗi tải định mức: " + e.message); } finally { setListLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const del = async (id) => {
    const r = rows.find((x) => x.id === id);
    if (!confirm(`Xóa định mức ${r?.bom_code || ""}${r?.name ? ` – ${r.name}` : ""}?`)) return;
    try { await bomApi.remove(id); toast.success("Đã xóa thành công"); load(); } catch (e) { toast.error("Lỗi xóa: " + e.message); }
  };

  if (view === "form")
    return <BomForm key={editId || "new"} lookups={lookups} editId={editId} copyId={copyId} onBack={() => { setView("list"); setEditId(null); setCopyId(null); load(); }}
      onSaved={(newId) => { if (newId) { setEditId(newId); setCopyId(null); } else { setView("list"); setEditId(null); setCopyId(null); } load(); }} />;

  const columns = [
    { key: "bom_code", label: "Mã", filter: "text", render: (r) => <button onClick={() => openForm({ edit: r.id })} className="font-medium text-blue-600 hover:underline">{r.bom_code}</button> },
    { key: "name", label: "Tên định mức", filter: "text", tdClass: "text-slate-800", render: (r) => (
        <span className="inline-flex items-center gap-1.5">{r.name}
          {r.process_id && <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700"><GitBranch size={11} /> từ QT</span>}</span>
      ) },
    { key: "product_name", label: "Sản phẩm đầu ra", filter: "select", tdClass: "text-slate-600" },
    { key: "bom_type", label: "Loại", filter: "select", render: (r) => r.bom_type === "Công thức pha màu"
        ? <span className="inline-flex items-center gap-1 text-blue-600"><FlaskConical size={14} /> {r.bom_type}</span> : r.bom_type },
    { key: "line_count", label: "Số dòng", align: "center" },
    { key: "output_quantity", label: "Định mức", render: (r) => `${fmt(r.output_quantity)} ${r.output_unit || ""}` },
    { key: "status", label: "Trạng thái", filter: "select", render: (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span> },
    { key: "_act", label: "", align: "right", render: (r) => (<>
        {can("bom", "create") && <button onClick={() => openForm({ copy: r.id })} title="Sao chép" className="text-slate-400 hover:text-blue-600 p-1"><Copy size={15} /></button>}
        <button onClick={() => openForm({ edit: r.id })} title="Sửa" className="text-slate-400 hover:text-blue-600 p-1"><Pencil size={15} /></button>
        {can("bom", "delete") && <button onClick={() => del(r.id)} title="Xóa" className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={15} /></button>}
      </>) },
  ];

  return (
    <div className="space-y-5">
      <ListHeader title="Định mức / Công thức (BOM)" actions={<>
        <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        {can("bom", "create") && <button onClick={() => openForm({})} className="btn-primary"><Plus size={16} /> Tạo định mức</button>}
      </>} />
      <DataTable loading={listLoading} columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Chưa có định mức" />
    </div>
  );
}
