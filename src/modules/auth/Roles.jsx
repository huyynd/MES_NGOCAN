import React, { useState, useEffect } from "react";
import { Shield, Plus, Edit, Trash2, Users, AlertCircle, Search, RotateCcw, Save } from "lucide-react";
import { ListHeader, DataTable, Section, useSaving, useRemembered, DialogBehavior, confirmClose } from "../../components.jsx";
import { roles, users } from "../../mesApi.js";
import { toast, inputCls, statusClass } from "../../ui.js";
import { PermissionEditor } from "./PermissionEditor.jsx";

function RoleForm({ record, onBack, onSaved }) {
  const isEdit = !!record?.id;
  const [f, setF] = useState({ 
    role_code: record?.role_code || "",
    name: record?.name || "", 
    description: record?.description || "", 
    status: record?.status || "Hoạt động" 
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  
  const [saving, guard] = useSaving();
  const save = async () => {
    if (!f.name) return toast.error("Vui lòng nhập tên vai trò");
    try {
      if (isEdit) {
        await roles.update(record.id, f);
        toast.success("Đã lưu vai trò thành công"); // ở lại form
      } else {
        const created = await roles.create(f);
        toast.success("Đã lưu vai trò thành công");
        onSaved(created); // tạo mới → ở lại màn chi tiết của bản ghi vừa tạo
      }
    } catch (e) {
      toast.error("Lỗi: " + e.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <h2 className="text-xl font-bold text-slate-800">{isEdit ? "Sửa vai trò" : "Thêm vai trò mới"}</h2>
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors">Hủy</button>
          <button onClick={() => guard(save)} disabled={saving} className="btn-primary disabled:opacity-60"><Save size={16} /> {saving ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Mã vai trò (tự sinh nếu để trống)</label>
          <input className={inputCls} value={f.role_code} onChange={(e) => set("role_code", e.target.value)} placeholder="VD: VT001…" disabled={isEdit} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Tên vai trò <span className="text-rose-500">*</span></label>
          <input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Nhập tên…" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Trạng thái</label>
          <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option>Hoạt động</option>
            <option>Không hoạt động</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Mô tả</label>
          <textarea className={inputCls + " resize-none"} rows="3" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Mô tả vai trò này làm gì…"></textarea>
        </div>
      </div>
    </div>
  );
}

export default function RolesModule() {
  const [list, setList] = useState([]);
  const [userList, setUserList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useRemembered("roles:q", "");

  const [selectedRole, setSelectedRole] = useState(null);
  const [activeTab, setActiveTab] = useState("permissions"); // 'permissions', 'users'

  // Edit user custom permissions
  const [editingUser, setEditingUser] = useState(null);
  
  // Edit role info
  const [editingRole, setEditingRole] = useState(null);

  const fetchRoles = async () => {
    try {
      setLoading(true);
      const data = await roles.list();
      setList(data || []);
    } catch (e) {
      toast.error("Không lấy được danh sách vai trò");
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await users.list();
      setUserList(Array.isArray(res) ? res : res?.data || []);
    } catch (e) { toast.error("Không tải được danh sách tài khoản — bấm Làm mới: " + e.message); }
  };

  useEffect(() => {
    fetchRoles();
    fetchUsers();
  }, []);

  const handleRoleSelect = (role) => {
    setSelectedRole(role);
    setActiveTab("permissions");
  };

  const handleDeleteRole = async (r) => {
    if (!confirm(`Bạn có chắc muốn xóa vai trò "${r.name}"?`)) return;
    try {
      await roles.remove(r.id);
      toast.success("Đã xóa vai trò");
      fetchRoles();
    } catch (e) {
      toast.error("Lỗi xóa vai trò: " + e.message);
    }
  };

  const filteredRoles = list.filter(r => r.name.toLowerCase().includes(q.toLowerCase()) || r.role_code.toLowerCase().includes(q.toLowerCase()));
  
  // Users belonging to the selected role
  const roleUsers = userList.filter(u => u.role_id === selectedRole?.id);

  const handleSaveRolePerms = async (newPerms) => {
    if (!selectedRole) return;
    try {
      await roles.savePermissions(selectedRole.id, newPerms, selectedRole.parent_id || null);
      toast.success("Cập nhật quyền vai trò thành công");
      fetchRoles();
      setSelectedRole({ ...selectedRole, permissions: newPerms });
    } catch (e) {
      toast.error("Cập nhật quyền thất bại");
    }
  };

  const handleSaveUserPerms = async (newPerms) => {
    if (!editingUser) return;
    try {
      await users.update(editingUser.id, { permissions: newPerms });
      toast.success("Đã lưu quyền riêng cho tài khoản");
      fetchUsers();
      setEditingUser(null);
    } catch (e) {
      toast.error("Cập nhật quyền tài khoản thất bại");
    }
  };

  if (editingRole) {
    return (
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-3xl mx-auto mt-6">
        <RoleForm key={editingRole.id || "new"} record={editingRole.id ? editingRole : null} onBack={() => { setEditingRole(null); fetchRoles(); }} onSaved={(rec) => { setEditingRole(rec?.id ? rec : null); fetchRoles(); }} />
      </div>
    );
  }

  if (!selectedRole) {
    return (
      <div className="space-y-4">
        <ListHeader title="Vai trò & Phân quyền" actions={(
          <>
            <div className="relative mr-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input type="text" placeholder="Tìm vai trò…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 w-48 md:w-64" />
            </div>
            <button onClick={fetchRoles} className="btn-ghost"><RotateCcw size={16} /> Làm mới</button>
            <button onClick={() => setEditingRole({})} className="btn-primary"><Plus size={16} /> Thêm mới</button>
          </>
        )} />
        <div className="bg-white rounded-xl shadow-sm border border-slate-200">
          <DataTable
            loading={loading}
            rows={filteredRoles}
            rowKey={(r) => r.id}
            columns={[
              { key: "role_code", label: "Mã VT" },
              { key: "name", label: "Tên vai trò", render: (r) => <div className="font-semibold text-slate-800">{r.name}</div> },
              { key: "description", label: "Mô tả" },
              { key: "status", label: "Trạng thái", render: (r) => (
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span>
              )},
              { key: "_actions", label: "", align: "right", render: (r) => (
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => handleRoleSelect(r)} className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition">Cấu hình</button>
                  <button onClick={() => setEditingRole(r)} className="p-1.5 text-slate-400 hover:text-blue-600 transition" title="Sửa vai trò"><Edit size={16} /></button>
                  <button onClick={() => handleDeleteRole(r)} className="p-1.5 text-slate-400 hover:text-rose-600 transition" title="Xóa vai trò"><Trash2 size={16} /></button>
                </div>
              )}
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <button onClick={() => setSelectedRole(null)} className="px-3 py-1.5 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition">
          &larr; Quay lại
        </button>
        <div>
          <h2 className="text-xl font-bold text-slate-800">{selectedRole.name}</h2>
          <div className="text-sm text-slate-500">{selectedRole.role_code} - {selectedRole.description}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-2 gap-4">
          <button onClick={() => setActiveTab("permissions")} className={`pb-2 px-2 border-b-2 font-medium text-sm transition ${activeTab === 'permissions' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Quyền truy cập</button>
          <button onClick={() => setActiveTab("users")} className={`pb-2 px-2 border-b-2 font-medium text-sm transition ${activeTab === 'users' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Tài khoản ({roleUsers.length})</button>
        </div>

        <div className="p-4 bg-white flex-1 min-h-[500px]">
          {activeTab === "permissions" && (
            <PermissionEditor roleName={selectedRole.name} initialPerms={selectedRole.permissions || {}} onSave={handleSaveRolePerms} onCancel={() => setSelectedRole(null)} />
          )}
          
          {activeTab === "users" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Users size={18}/> Danh sách tài khoản mang vai trò {selectedRole.name}</h3>
                <button onClick={() => toast.info("Gắn tài khoản vào vai trò đang phát triển…")} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium flex items-center gap-1"><Plus size={16}/> Thêm tài khoản</button>
              </div>
              <DataTable
                rows={roleUsers}
                rowKey={(u) => u.id}
                columns={[
                  { key: "username", label: "Tài khoản", render: (u) => <span className="font-medium text-slate-800">{u.username}</span> },
                  { key: "full_name", label: "Họ tên" },
                  { key: "team", label: "Tổ/Đội" },
                  { key: "status", label: "Trạng thái" },
                  { key: "_actions", label: "", align: "right", render: (u) => (
                    <button onClick={() => setEditingUser(u)} className="px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-sm font-medium">Quyền riêng</button>
                  )}
                ]}
              />
            </div>
          )}
        </div>
      </div>

      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            <DialogBehavior onClose={() => setEditingUser(null)} />
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-blue-50">
              <div>
                <h3 className="text-lg font-bold text-blue-900">Quyền bổ sung: {editingUser.full_name || editingUser.username}</h3>
                <div className="text-sm text-blue-700 flex items-center gap-1"><AlertCircle size={14}/> Các quyền dưới đây sẽ ĐƯỢC CỘNG THÊM hoặc GHI ĐÈ lên quyền gốc của vai trò {selectedRole.name}</div>
              </div>
              <button onClick={(e) => confirmClose(e, () => setEditingUser(null))} aria-label="Đóng" className="p-2 text-slate-400 hover:bg-white rounded-lg transition"><Trash2 size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
              <PermissionEditor roleName={editingUser.username} initialPerms={editingUser.permissions || {}} onSave={handleSaveUserPerms} onCancel={() => setEditingUser(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
