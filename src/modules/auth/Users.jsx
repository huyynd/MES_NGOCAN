import React, { useState, useEffect, useCallback } from "react";
import { RotateCcw, Plus, Pencil, Trash2, Save } from "lucide-react";
import { ListHeader, DataTable, PageHeader, Section, useSaving } from "../../components.jsx";
import { users, roles } from "../../mesApi.js";
import {  inputCls, statusClass , toast } from "../../ui.js";

const F = ({ label, required, children }) => (
  <div><label className="block text-sm font-medium text-slate-600 mb-1.5">{label} {required && <span className="text-rose-500">*</span>}</label>{children}</div>
);

function UserForm({ record, roleList, teams, employees, onBack, onSaved }) {
  const isEdit = !!record?.id;
  const [f, setF] = useState({ username: record?.username || "", password: "", full_name: record?.full_name || "", role_id: record?.role_id || "", status: record?.status || "Hoạt động", team: record?.team || "", linked_worker: record?.linked_worker || "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const [saving, guard] = useSaving();
  const save = async () => {
    if (!f.username) return toast.error("Nhập tài khoản");
    if (!isEdit && !f.password) return toast.error("Nhập mật khẩu");
    try {
      if (isEdit) { await users.update(record.id, f); toast.success("Đã lưu thành công"); } // ở lại form
      else { const r = await users.create(f); toast.success("Đã lưu thành công"); onSaved(r?.id ? { ...f, password: "", id: r.id } : null); } // tạo mới → ở lại màn chi tiết của bản ghi vừa tạo
    } catch (e) { toast.error("Lỗi: " + e.message); }
  };
  return (
    <div className="space-y-5">
      <PageHeader title={isEdit ? "Sửa tài khoản" : "Thêm tài khoản"} onBack={onBack}
        actions={<button onClick={() => guard(save)} disabled={saving} className="btn-primary"><Save size={16} /> {saving ? "Đang lưu…" : "Lưu"}</button>} />
      <Section title="Thông tin tài khoản">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          <F label="Tài khoản" required><input className={inputCls} value={f.username} onChange={(e) => set("username", e.target.value)} placeholder="tên đăng nhập" /></F>
          <F label={isEdit ? "Mật khẩu mới (để trống nếu không đổi)" : "Mật khẩu"} required={!isEdit}>
            <input type="password" className={inputCls} value={f.password} onChange={(e) => set("password", e.target.value)} placeholder={isEdit ? "••••••" : ""} />
          </F>
          <F label="Họ và tên"><input className={inputCls} value={f.full_name} onChange={(e) => set("full_name", e.target.value)} /></F>
          <F label="Vai trò">
            <select className={inputCls} value={f.role_id} onChange={(e) => set("role_id", e.target.value)}>
              <option value="">-- Chọn --</option>
              {roleList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </F>
          <F label="Trạng thái">
            <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}><option>Hoạt động</option><option>Không hoạt động</option></select>
          </F>
          <F label="Đội (giới hạn xem ở màn Thực thi)">
            <select className={inputCls} value={f.team} onChange={(e) => set("team", e.target.value)}>
              <option value="">-- Không giới hạn (xem tất cả) --</option>
              {(teams || []).map((t) => <option key={t}>{t}</option>)}
            </select>
          </F>
          <F label="Liên kết với công nhân (Báo cáo)">
            <select className={inputCls} value={f.linked_worker} onChange={(e) => set("linked_worker", e.target.value)}>
              <option value="">-- Không giới hạn --</option>
              {(employees || []).map((emp) => <option key={emp.name} value={emp.name}>{emp.name}</option>)}
            </select>
          </F>
        </div>
      </Section>
    </div>
  );
}

export default function UsersModule({ lookups }) {
  const [rows, setRows] = useState([]);
  const [roleList, setRoleList] = useState([]);
  const [editing, setEditing] = useState(null);
  const teams = [...new Set(((lookups && lookups.employees) || []).map((e) => e.factory).filter(Boolean))];
  const [listLoading, setListLoading] = useState(true);
  const load = useCallback(async () => { setListLoading(true); try { setRows(await users.list()); } catch (e) { toast.error("Lỗi tải tài khoản: " + e.message); } finally { setListLoading(false); } }, []);
  useEffect(() => { load(); roles.list().then(setRoleList).catch((e) => toast.error("Không tải được danh sách vai trò — bấm Làm mới: " + e.message)); }, [load]);
  const del = async (id) => { const u = rows.find((x) => x.id === id); if (!confirm(`Xóa tài khoản ${u?.username || ""}${u?.full_name ? ` (${u.full_name})` : ""}?`)) return; try { await users.remove(id); toast.success("Đã xóa thành công"); load(); } catch (e) { toast.error("Lỗi xóa: " + e.message); } };

  const columns = [
    { key: "username", label: "Tài khoản", filter: "text", render: (u) => <button onClick={() => setEditing(u)} className="font-medium text-blue-600 hover:underline">{u.username}</button> },
    { key: "full_name", label: "Họ và tên", filter: "text", render: (u) => u.full_name || "—" },
    { key: "role_name", label: "Vai trò", filter: "select", tdClass: "text-slate-600", render: (u) => u.role_name || "—" },
    { key: "status", label: "Trạng thái", filter: "select", render: (u) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(u.status)}`}>{u.status}</span> },
    { key: "_act", label: "", align: "right", render: (u) => (<>
        <button onClick={() => setEditing(u)} className="text-slate-400 hover:text-blue-600 p-1"><Pencil size={15} /></button>
        <button onClick={() => del(u.id)} className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={15} /></button>
      </>) },
  ];

  if (editing)
    return <UserForm key={editing.id || "new"} record={editing.id ? editing : null} roleList={roleList} teams={teams} employees={lookups?.employees || []}
      onBack={() => { setEditing(null); load(); }} onSaved={(rec) => { setEditing(rec?.id ? rec : null); load(); }} />;

  return (
    <div className="space-y-5">
      <ListHeader title="Tài khoản" actions={<>
        <button onClick={load} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
        <button onClick={() => setEditing({})} className="btn-primary"><Plus size={16} /> Thêm tài khoản</button>
      </>} />
      <DataTable loading={listLoading} columns={columns} rows={rows} rowKey={(u) => u.id} emptyText="Chưa có tài khoản" />
    </div>
  );
}
