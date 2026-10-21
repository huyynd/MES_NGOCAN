import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, Plus, Trash2, Pencil, Save, Upload, Download, FileDown } from "lucide-react";
import * as XLSX from "xlsx";
import { resource, customerOrders, machineOrders, nextCode } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import { ListHeader, DataTable, PageHeader, Section, useSaving } from "../../components.jsx";
import {  inputCls, statusClass, fmt, fmtDate , toast } from "../../ui.js";

const isObjOptions = (f) => f.type === "select" && f.options && typeof f.options[0] === "object";

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
  </div>
);

/* ---- Trang thêm/sửa tổng quát ---- */
function RecordForm({ cfg, record, onBack, onSaved, onOpenOrder, onOpenProductionOrder }) {
  const isEdit = !!record?.id;
  const [f, setF] = useState(() => {
    const init = {};
    cfg.fields.forEach((fl) => { init[fl.key] = record?.[fl.key] ?? fl.default ?? ""; });
    return init;
  });
  // Trường có resetOn: "x" bị xóa khi đổi trường x (vd đổi Kho → xóa Khu vực cũ)
  const set = (k, v) => setF((s) => {
    const n = { ...s, [k]: v };
    cfg.fields.forEach((fl) => { if (fl.resetOn === k && s[k] !== v) n[fl.key] = ""; });
    return n;
  });
  const api = resource(cfg.resource);

  // Mã: hiện mã thật khi sửa, mã dự kiến khi thêm mới
  const codeKey = cfg.columns[0]?.key;
  const [code, setCode] = useState(isEdit ? (record?.[codeKey] || "") : "");
  useEffect(() => { if (!isEdit) nextCode(cfg.resource).then(setCode).catch(() => {}); }, [isEdit, cfg.resource]); // eslint-disable-line

  // Dữ liệu liên quan: đơn hàng đã mua (chỉ với khách hàng, chế độ sửa)
  const showOrders = cfg.resource === "customers" && isEdit;
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    if (showOrders) customerOrders(record.id).then(setOrders).catch((e) => toast.error("Không tải được đơn hàng của khách — bấm Làm mới: " + e.message));
  }, [showOrders, record?.id]); // eslint-disable-line

  // Dữ liệu liên quan: lệnh sản xuất đã chạy (chỉ với máy móc, chế độ sửa)
  const showMachine = cfg.resource === "machines" && isEdit;
  const [mTasks, setMTasks] = useState([]);
  useEffect(() => {
    if (showMachine) machineOrders(record.id).then(setMTasks).catch((e) => toast.error("Không tải được công việc của máy — bấm Làm mới: " + e.message));
  }, [showMachine, record?.id]); // eslint-disable-line

  const [saving, guard] = useSaving();
  const save = async () => {
    for (const fl of cfg.fields)
      if (fl.required && !f[fl.key]) return toast.error(`Vui lòng nhập ${fl.label}`);
    try {
      if (isEdit) {
        await api.update(record.id, f);
        toast.success("Đã lưu thành công"); // ở lại màn chi tiết, không thoát ra list
      } else {
        const created = await api.create(f);
        toast.success("Đã lưu thành công"); onSaved(created); // tạo mới → ở lại màn chi tiết của bản ghi vừa tạo
      }
    } catch (e) { toast.error("Lỗi lưu: " + e.message); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={`${isEdit ? "Sửa" : "Thêm"} ${cfg.title.toLowerCase()}`} onBack={onBack}
        actions={<button onClick={() => guard(save)} disabled={saving} className="btn-primary"><Save size={16} /> {saving ? "Đang lưu…" : "Lưu"}</button>} />
      {(() => {
        const groups = {};
        const defaultGroup = cfg.fields.some(f => f.group === "Thông tin chung") ? "Thông tin chung" : "Thông tin";
        groups[defaultGroup] = [{ _isCode: true }];
        cfg.fields.filter((fl) => !(fl.readOnly && !isEdit)).forEach((fl) => {
          const g = fl.group || defaultGroup;
          if (!groups[g]) groups[g] = [];
          groups[g].push(fl);
        });

        return Object.keys(groups).map((gName) => (
          <Section key={gName} title={gName}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
              {groups[gName].map((fl) => {
                if (fl._isCode) {
                  return (
                    <Field key="code" label={cfg.columns[0]?.label || "Mã"}>
                      <input className={inputCls + " bg-slate-50 text-slate-500"} disabled value={code || "(tự sinh khi lưu)"} />
                    </Field>
                  );
                }
                return (
                  <div key={fl.key} className={fl.full ? "md:col-span-2 lg:col-span-3" : ""}>
                    <Field label={fl.label} required={fl.required}>
                      {fl.readOnly ? (
                        fl.badge
                          ? <div className="pt-1"><span className={`inline-flex px-2.5 py-1 rounded-full text-sm font-medium ${statusClass(record?.[fl.key])}`}>{record?.[fl.key] || "—"}</span></div>
                          : <input className={inputCls + " bg-slate-50 text-slate-500"} disabled value={record?.[fl.key] ?? "—"} />
                      ) : fl.type === "checkbox" ? (
                        <label className="flex items-center gap-2 mt-2 cursor-pointer">
                          <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={!!f[fl.key]} onChange={(e) => set(fl.key, e.target.checked)} />
                          <span className="text-sm font-medium text-slate-700">{fl.checkboxLabel || fl.label}</span>
                        </label>
                      ) : fl.type === "select" ? (
                        <select className={inputCls} value={f[fl.key] ?? ""} onChange={(e) => set(fl.key, e.target.value)}>
                          <option value="">-- Chọn --</option>
                          {(typeof fl.options === 'function' ? fl.options(f) : fl.options).map((o) =>
                            typeof o === "string"
                              ? <option key={o} value={o}>{o}</option>
                              : <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input type={fl.type || "text"} className={inputCls} value={f[fl.key] ?? ""}
                          onChange={(e) => set(fl.key, e.target.value)} placeholder={fl.placeholder || ""} />
                      )}
                    </Field>
                  </div>
                );
              })}
            </div>
          </Section>
        ));
      })()}

      {showOrders && (
        <Section title={`Đơn hàng đã mua (${orders.length})`}>
          {orders.length === 0 ? (
            <div className="text-slate-400 text-sm">Khách hàng này chưa có đơn hàng.</div>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => (
                <div key={o.id} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex-wrap">
                    <div className="flex items-center gap-3">
                      <button onClick={() => onOpenOrder?.(o.id)} className="font-semibold text-blue-600 hover:underline">{o.order_code}</button>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(o.status)}`}>{o.status}</span>
                    </div>
                    <div className="text-xs text-slate-500">Đặt: {fmtDate(o.order_date)} · Giao: {fmtDate(o.due_date)}</div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-slate-400 text-xs uppercase">
                      <tr>{["Sản phẩm", "Số lượng", "Màu", "Kích thước", "Độ dày"].map((h) =>
                        <th key={h} className="text-left px-4 py-2 font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {o.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-2 text-slate-800">{it.product_name} <span className="text-slate-400">({it.product_code})</span></td>
                          <td className="px-4 py-2">{fmt(it.quantity)} {it.unit || ""}</td>
                          <td className="px-4 py-2">{it.attr_color || "—"}</td>
                          <td className="px-4 py-2">{it.attr_size || "—"}</td>
                          <td className="px-4 py-2">{it.attr_thickness || "—"}</td>
                        </tr>
                      ))}
                      {!o.items.length && <tr><td colSpan={5} className="px-4 py-3 text-center text-slate-400">Không có dòng hàng</td></tr>}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {showMachine && (
        <Section title={`Lệnh sản xuất đã chạy trên máy (${mTasks.length})`} bodyClass="p-0">
          {mTasks.length === 0 ? (
            <div className="p-6 text-slate-400 text-sm">Máy này chưa có phân công sản xuất nào.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>{["Mã lệnh", "Sản phẩm", "Công đoạn", "Sản lượng", "Ngày SX", "Ca", "Trạng thái"].map((h) =>
                  <th key={h} className="text-left px-4 py-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mTasks.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3"><button onClick={() => onOpenProductionOrder?.(t.production_order_id)} className="font-medium text-blue-600 hover:underline">{t.order_code}</button></td>
                    <td className="px-4 py-3 text-slate-800">{t.product_name} <span className="text-slate-400">({t.product_code})</span></td>
                    <td className="px-4 py-3">{t.stage}</td>
                    <td className="px-4 py-3">{fmt(t.quantity)}</td>
                    <td className="px-4 py-3">{fmtDate(t.planned_date)}</td>
                    <td className="px-4 py-3">{t.shift || "—"}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(t.status)}`}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}
    </div>
  );
}

/* ---- Bảng danh mục tổng quát ---- */
function MasterTable({ cfg, onOpenOrder, onOpenProductionOrder }) {
  const { can } = usePerm();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null); // record hoặc {} để thêm mới
  const api = resource(cfg.resource);

  const load = useCallback(async () => {
    try { setRows(await api.list()); } catch (e) { toast.error("Lỗi tải: " + e.message); }
  }, [cfg.resource]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const del = async (id) => {
    if (!confirm("Xóa bản ghi này?")) return;
    try { await api.remove(id); toast.success("Đã xóa thành công"); load(); } catch (e) { toast.error("Lỗi xóa: " + e.message); }
  };

  // ---- Export Excel ----
  const exportExcel = () => {
    const data = rows.map((r) => {
      const o = {};
      const codeCol = cfg.columns[0];
      o[codeCol.label] = r[codeCol.key];
      cfg.fields.forEach((f) => {
        let v = r[f.key];
        if (isObjOptions(f)) v = f.options.find((op) => op.value === v)?.label ?? "";
        o[f.label] = v ?? "";
      });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cfg.title.slice(0, 31));
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cfg.title}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---- Tải file mẫu (chỉ tiêu đề các trường nhập) ----
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([cfg.fields.map((f) => f.label)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mau");
    const wbout2 = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob2 = new Blob([wbout2], { type: 'application/octet-stream' });
    const url2 = URL.createObjectURL(blob2);
    const a2 = document.createElement('a');
    a2.href = url2;
    a2.download = `Mau_${cfg.title}.xlsx`;
    document.body.appendChild(a2);
    a2.click();
    document.body.removeChild(a2);
    setTimeout(() => URL.revokeObjectURL(url2), 1000);
  };

  // ---- Import Excel ----
  const [importing, setImporting] = useState(false);
  const importExcel = async (file) => {
    if (importing) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const codeCol = cfg.columns[0]; // cột mã (vd Mã NV) — gửi lên để backend chặn trùng
      const payloads = json.map((row) => {
        const p = {};
        if (codeCol) { const cv = row[codeCol.label]; if (cv !== undefined && cv !== "") p[codeCol.key] = String(cv).trim(); }
        cfg.fields.forEach((f) => {
          let v = row[f.label];
          if (v === undefined || v === "") return;
          if (isObjOptions(f)) v = f.options.find((op) => String(op.label) === String(v))?.value ?? v;
          p[f.key] = typeof v === "string" ? v.trim() : v;
        });
        return p;
      }).filter((p) => Object.keys(p).filter((k) => k !== (codeCol && codeCol.key)).length);
      if (!payloads.length) return toast.error("Không đọc được dòng dữ liệu hợp lệ. Kiểm tra tiêu đề cột khớp file mẫu.");
      if (!confirm(`Nhập ${payloads.length} dòng vào ${cfg.title}?`)) return;
      setImporting(true);
      const res = await api.importRows(payloads);
      let msg = `Đã nhập ${res.inserted}/${payloads.length} dòng.`;
      if (res.failed) msg += `\nLỗi ${res.failed} dòng:\n` + res.errors.map((e) => `· Dòng ${e.row}: ${e.message}`).join("\n");
      (res.failed ? toast.error : toast.success)(msg); // D-03: chỉ báo đỏ khi có dòng lỗi
      load();
    } catch (e) { toast.error("Lỗi đọc file: " + e.message); }
    finally { setImporting(false); }
  };

  const dtCols = [
    ...cfg.columns.map((c, ci) => ({
      key: c.key, label: c.label,
      filter: c.badge ? "select" : (c.filter || "text"),
      filterValue: c.render && !c.badge ? c.render : undefined,
      render: ci === 0
        ? (r) => <button onClick={() => setEditing(r)} className="font-medium text-blue-600 hover:underline">{r[c.key] || "—"}</button>
        : c.badge
          ? (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(r[c.key])}`}>{r[c.key]}</span>
          : c.render ? c.render : (r) => (r[c.key] || "—"),
    })),
    {
      key: "__act", label: "", align: "right",
      render: (r) => (<>
        {can("md_" + cfg.resource, "edit") && <button onClick={() => setEditing(r)} className="text-slate-400 hover:text-blue-600 p-1"><Pencil size={15} /></button>}
        {can("md_" + cfg.resource, "delete") && <button onClick={() => del(r.id)} className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={15} /></button>}
      </>),
    },
  ];

  if (editing)
    return <RecordForm key={editing.id || "new"} cfg={cfg} record={editing.id ? editing : null} onOpenOrder={onOpenOrder} onOpenProductionOrder={onOpenProductionOrder}
      onBack={() => { setEditing(null); load(); }} onSaved={(rec) => { setEditing(rec?.id ? rec : null); load(); }} />;

  return (
    <div className="space-y-4">
      <ListHeader title={cfg.title} actions={<>
        <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        <button onClick={downloadTemplate} className="btn-ghost"><FileDown size={16} /> Tải mẫu</button>
        {can("md_" + cfg.resource, "create") && (
          <label className={`btn-ghost ${importing ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}>
            <Upload size={16} /> {importing ? "Đang nhập…" : "Nhập Excel"}
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importing}
              onChange={(e) => { if (e.target.files[0]) importExcel(e.target.files[0]); e.target.value = ""; }} />
          </label>
        )}
        <button onClick={exportExcel} className="btn-ghost"><Download size={16} /> Xuất Excel</button>
        {can("md_" + cfg.resource, "create") && <button onClick={() => setEditing({})} className="btn-primary"><Plus size={16} /> Thêm mới</button>}
      </>} />
      <DataTable rows={rows} rowKey={(r) => r.id} emptyText="Chưa có dữ liệu" columns={dtCols} />
    </div>
  );
}

/* ---- Cấu hình từng danh mục ---- */
function buildConfigs(lookups) {
  const warehouseOptions = (lookups.warehouses || []).map((w) => ({ value: w.id, label: w.name }));
  const warehouseName = (id) => (lookups.warehouses || []).find((w) => w.id === id)?.name || "—";
  const zoneName = (id) => (lookups.zones || []).find((z) => z.id === id)?.name || "—";

  return {
    customers: {
      title: "Khách hàng", resource: "customers",
      columns: [
        { key: "customer_code", label: "Mã KH" }, { key: "name", label: "Tên khách hàng" },
        { key: "customer_type", label: "Loại", filter: "select" }, { key: "phone", label: "Điện thoại" },
        { key: "address", label: "Địa chỉ" }, { key: "status", label: "Trạng thái", badge: true },
      ],
      fields: [
        { key: "name", label: "Tên khách hàng", required: true, full: true },
        { key: "customer_type", label: "Loại", type: "select", options: ["Khách sỉ", "Khách lẻ"], default: "Khách sỉ" },
        { key: "status", label: "Trạng thái", type: "select", options: ["Hoạt động", "Không hoạt động"], default: "Hoạt động" },
        { key: "phone", label: "Điện thoại" }, { key: "email", label: "Email" },
        { key: "address", label: "Địa chỉ", full: true },
      ],
    },
    machines: {
      title: "Máy móc", resource: "machines",
      columns: [
        { key: "machine_code", label: "Mã máy" }, { key: "name", label: "Tên máy" },
        { key: "factory", label: "Nhà máy", filter: "select" }, { key: "machine_type", label: "Loại máy", filter: "select" },
        { key: "production_status", label: "Trạng thái SX", badge: true },
        { key: "status", label: "Tình trạng", badge: true },
      ],
      fields: [
        { key: "name", label: "Tên máy", required: true, full: true },
        { key: "factory", label: "Nhà máy", type: "select", required: true, options: ["Nhà máy thổi", "Nhà máy cắt"] },
        { key: "machine_type", label: "Loại máy", placeholder: "Máy thổi lớn / Máy cắt..." },
        { key: "production_status", label: "Trạng thái SX (tự động)", readOnly: true, badge: true },
        { key: "status", label: "Tình trạng máy", type: "select", options: ["Hoạt động", "Bảo trì", "Ngừng"], default: "Hoạt động" },
      ],
    },
    warehouses: {
      title: "Kho", resource: "warehouses",
      columns: [
        { key: "warehouse_code", label: "Mã kho" }, { key: "name", label: "Tên kho" },
        { key: "warehouse_type", label: "Loại kho", filter: "select" },
        { key: "factory", label: "Nhà máy", filter: "select" },
        { key: "status", label: "Trạng thái", badge: true },
      ],
      fields: [
        // Thông tin chung
        { key: "name", label: "Tên kho", required: true, full: true, group: "Thông tin chung" },
        { key: "warehouse_type", label: "Loại kho", type: "select", options: ["NVL", "BTP", "TP"], default: "NVL", group: "Thông tin chung" },
        { key: "purpose", label: "Mục đích sử dụng", group: "Thông tin chung" },
        { key: "status", label: "Trạng thái", type: "select", options: ["Hoạt động", "Đang kiểm đếm", "Ngừng hoạt động"], default: "Hoạt động", group: "Thông tin chung" },
        // Địa điểm & quản lý
        { key: "factory", label: "Nhà máy", type: "select", options: ["Nhà máy 1", "Nhà máy 2", "Nhà máy 3"], group: "Địa điểm & quản lý", required: true },
        { key: "workshop", label: "Xưởng", group: "Địa điểm & quản lý" },
        { key: "manager", label: "Người phụ trách", group: "Địa điểm & quản lý" },
        { key: "department", label: "Bộ phận quản lý", group: "Địa điểm & quản lý" },
        { key: "phone", label: "Số điện thoại", group: "Địa điểm & quản lý" },
        { key: "address", label: "Địa chỉ", full: true, group: "Địa điểm & quản lý" },
        // Cấu hình nghiệp vụ
        { key: "allow_inbound", label: "Cho phép nhập kho", type: "checkbox", default: true, group: "Cấu hình nghiệp vụ" },
        { key: "allow_outbound", label: "Cho phép xuất kho", type: "checkbox", default: true, group: "Cấu hình nghiệp vụ" },
        { key: "allow_transfer", label: "Cho phép chuyển kho", type: "checkbox", default: true, group: "Cấu hình nghiệp vụ" },
        { key: "allow_manufacturing", label: "Cấp phát sản xuất", type: "checkbox", default: true, group: "Cấu hình nghiệp vụ" },
        { key: "require_qc", label: "Yêu cầu QC khi nhập", type: "checkbox", default: false, group: "Cấu hình nghiệp vụ" },
        { key: "require_approval", label: "Yêu cầu phê duyệt", type: "checkbox", default: false, group: "Cấu hình nghiệp vụ" },
        { key: "outbound_method", label: "Phương pháp xuất kho", type: "select", options: ["FIFO", "FEFO", "LIFO", "Theo chỉ định"], default: "FIFO", group: "Cấu hình nghiệp vụ" },
        // Cấu hình nâng cao
        { key: "capacity_unit", label: "Đơn vị sức chứa", type: "select", options: ["Pallet", "Kg", "Tấn", "Thùng", "m³"], group: "Cấu hình nâng cao" },
        { key: "max_capacity", label: "Sức chứa tối đa", type: "number", group: "Cấu hình nâng cao" },
        { key: "capacity_warning", label: "Cảnh báo sức chứa", type: "number", group: "Cấu hình nâng cao" },
        { key: "description", label: "Mô tả / Ghi chú", full: true, group: "Cấu hình nâng cao" },
      ],
    },
    zones: {
      title: "Khu vực", resource: "zones",
      columns: [
        { key: "zone_code", label: "Mã khu" }, { key: "name", label: "Tên khu" },
        { key: "warehouse_id", label: "Thuộc kho", filter: "select", filterValue: warehouseName, render: (r) => warehouseName(r.warehouse_id) },
        { key: "status", label: "Trạng thái", badge: true },
      ],
      fields: [
        { key: "warehouse_id", label: "Thuộc kho", type: "select", required: true, options: warehouseOptions },
        { key: "name", label: "Tên khu vực", required: true, full: true },
        { key: "description", label: "Mô tả / Ghi chú", full: true },
        { key: "status", label: "Trạng thái", type: "select", options: ["Hoạt động", "Không hoạt động"], default: "Hoạt động" },
      ],
    },
    locations: {
      title: "Vị trí lưu trữ", resource: "locations",
      columns: [
        { key: "location_code", label: "Mã vị trí" }, { key: "name", label: "Tên vị trí" },
        { key: "warehouse_id", label: "Thuộc kho", render: (r) => warehouseName(r.warehouse_id) },
        { key: "zone_id", label: "Thuộc khu", render: (r) => zoneName(r.zone_id) },
      ],
      fields: [
        { key: "warehouse_id", label: "Kho", type: "select", required: true, options: warehouseOptions },
        { key: "zone_id", label: "Khu vực", type: "select", required: true, resetOn: "warehouse_id", options: (f) => (lookups.zones || []).filter(z => z.warehouse_id === f.warehouse_id).map(z => ({ value: z.id, label: z.name })) },
        { key: "name", label: "Tên vị trí", required: true, full: true },
      ],
    },
    shifts: {
      title: "Ca làm việc", resource: "shifts",
      columns: [
        { key: "shift_code", label: "Mã ca" }, { key: "name", label: "Tên ca" },
        { key: "start_time", label: "Bắt đầu" }, { key: "end_time", label: "Kết thúc" },
        { key: "status", label: "Trạng thái", badge: true },
      ],
      fields: [
        { key: "name", label: "Tên ca", required: true, full: true },
        { key: "start_time", label: "Giờ bắt đầu", type: "time" },
        { key: "end_time", label: "Giờ kết thúc", type: "time" },
        { key: "status", label: "Trạng thái", type: "select", options: ["Hoạt động", "Không hoạt động"], default: "Hoạt động" },
      ],
    },
    employees: {
      title: "Nhân viên", resource: "employees",
      columns: [
        { key: "employee_code", label: "Mã NV" }, { key: "name", label: "Họ và tên" },
        { key: "factory", label: "Đơn vị", filter: "select" }, { key: "position", label: "Chức vụ", filter: "select" },
        { key: "skill_level", label: "Bậc thợ", filter: "select" }, { key: "phone", label: "Điện thoại" },
        { key: "status", label: "Trạng thái", badge: true },
      ],
      fields: [
        { key: "name", label: "Họ và tên", required: true, full: true },
        { key: "factory", label: "Đơn vị", type: "select", options: ["Nhà máy thổi", "Nhà máy cắt", "Quản lý"] },
        { key: "position", label: "Chức vụ" },
        { key: "skill_level", label: "Bậc thợ", placeholder: "Bậc 1..5" },
        { key: "phone", label: "Điện thoại" },
        { key: "status", label: "Trạng thái", type: "select", options: ["Hoạt động", "Không hoạt động"], default: "Hoạt động" },
      ],
    },
    roles: {
      title: "Vai trò", resource: "roles",
      columns: [
        { key: "role_code", label: "Mã VT" }, { key: "name", label: "Tên vai trò" },
        { key: "description", label: "Mô tả" }, { key: "status", label: "Trạng thái", badge: true },
      ],
      fields: [
        { key: "name", label: "Tên vai trò", required: true, full: true },
        { key: "description", label: "Mô tả", full: true },
        { key: "status", label: "Trạng thái", type: "select", options: ["Hoạt động", "Không hoạt động"], default: "Hoạt động" },
      ],
    },
  };
}

/* ---- Màn 1 danh mục (mỗi danh mục là 1 app riêng dưới nhóm Danh mục) ---- */
export default function MasterDataScreen({ lookups, entity, onOpenOrder, onOpenProductionOrder }) {
  const cfg = buildConfigs(lookups)[entity];
  if (!cfg) return <div className="text-slate-400 text-sm py-10">Danh mục không hợp lệ.</div>;
  return <MasterTable key={entity} cfg={cfg} onOpenOrder={onOpenOrder} onOpenProductionOrder={onOpenProductionOrder} />;
}
