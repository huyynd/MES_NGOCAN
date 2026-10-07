import React, { useState, useEffect } from "react";
import { 
  Recycle, Plus, Trash2, Save, FileText, Scale, CheckCircle2, 
  ArrowRight, Box, Package, Calendar, User, X
} from "lucide-react";
import { PageHeader, DataTable } from "../../components.jsx";
import { recycling, resource } from "../../mesApi.js";
import { inputCls, fmt, toast } from "../../ui.js";

const warehousesApi = resource("warehouses");

export default function RecyclingModule() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const [showModal, setShowModal] = useState(false);
  const [currentTicket, setCurrentTicket] = useState(null);
  const [step, setStep] = useState(1);
  const [warehouses, setWarehouses] = useState([]);

  const loadTickets = async () => {
    setLoading(true);
    try {
      const res = await recycling.list();
      setTickets(res);
    } catch (e) {
      toast.error("Lỗi tải danh sách phiếu: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadLookups = async () => {
    try {
      const wRes = await warehousesApi.list();
      setWarehouses(wRes);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadLookups();
    loadTickets();
  }, []);

  const openTicket = async (ticket) => {
    try {
      const res = await recycling.get(ticket.id);
      setCurrentTicket(res);
      // Determine step based on status
      if (res.status === 'Chờ cân') setStep(2);
      else if (res.status === 'Đang tái chế') setStep(3);
      else setStep(4); // Hoàn thành
      setShowModal(true);
    } catch (e) {
      toast.error("Lỗi tải chi tiết phiếu");
    }
  };

  const startNewTicket = () => {
    setCurrentTicket(null);
    setStep(1);
    setShowModal(true);
  };

  const cols = [
    { key: "ticket_code", label: "Mã phiếu", render: r => <span className="font-semibold text-blue-600">{r.ticket_code}</span> },
    { key: "export_date", label: "Ngày xuất", render: r => new Date(r.export_date).toLocaleDateString("vi-VN") },
    { key: "scrap_warehouse_name", label: "Kho xuất" },
    { key: "third_party_name", label: "Bên thứ 3" },
    { key: "status", label: "Trạng thái", render: r => (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
        r.status === 'Hoàn thành' ? 'bg-emerald-100 text-emerald-700' :
        r.status === 'Đang tái chế' ? 'bg-amber-100 text-amber-700' :
        'bg-slate-100 text-slate-700'
      }`}>{r.status}</span>
    )},
    { key: "expected_qty", label: "Tổng (kg)", align: "right", render: r => <span className="font-semibold">{fmt(r.expected_qty)}</span> },
    { key: "_act", label: "Thao tác", align: "center", render: r => (
      <button onClick={() => openTicket(r)} className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors ${r.status === 'Hoàn thành' ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
        {r.status === 'Hoàn thành' ? 'Xem chi tiết' : 'Chuyển trạng thái'}
      </button>
    )},
  ];

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Quản lý Tái chế" 
        icon={<Recycle size={28} className="text-emerald-500" />}
        actions={
          <button onClick={startNewTicket} className="btn-primary">
            <Plus size={18}/> Tạo phiếu tái chế
          </button>
        }
      />

      <DataTable
        rows={tickets}
        columns={cols}
        rowKey={r => r.id}
        loading={loading}
      />

      {showModal && (
        <TicketModal 
          ticket={currentTicket} 
          initialStep={step} 
          warehouses={warehouses}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); loadTickets(); }}
        />
      )}
    </div>
  );
}

function TicketModal({ ticket, initialStep, warehouses, onClose, onSuccess }) {
  const [step, setStep] = useState(initialStep);
  const [loading, setLoading] = useState(false);
  const isCompleted = ticket?.status === 'Hoàn thành';

  // Step 1 Form
  const [s1, setS1] = useState({
    export_date: ticket?.export_date?.slice(0,10) || new Date().toISOString().slice(0, 10),
    scrap_warehouse_id: ticket?.scrap_warehouse_id || "",
    expected_qty: ticket?.expected_qty || "",
    third_party_name: ticket?.third_party_name || "",
    note: ticket?.note || ""
  });

  // Step 2 Form
  const [s2, setS2] = useState({
    internal_scrap_qty: ticket?.internal_scrap_qty || "",
    mixed_scrap_qty: ticket?.mixed_scrap_qty || "",
    weighing_person: ticket?.weighing_person || ""
  });

  // Step 3 Form (Rolls)
  const [rolls, setRolls] = useState(ticket?.rolls || []);

  // Step 4 Form
  const [s4, setS4] = useState({
    import_warehouse_id: ticket?.import_warehouse_id || ""
  });

  const nextStep = async () => {
    setLoading(true);
    try {
      if (step === 1 && !ticket) {
        // Create new ticket
        const res = await recycling.create(s1);
        toast.success("Đã tạo phiếu: " + res.ticket_code);
        onSuccess(); // Close and reload
      } else if (step === 2) {
        await recycling.weigh(ticket.id, s2);
        toast.success("Ghi nhận cân thành công");
        onSuccess();
      } else if (step === 3) {
        await recycling.receiveRolls(ticket.id, rolls);
        toast.success("Ghi nhận cuộn thành công");
        setStep(4); // Move to step 4 without closing
      } else if (step === 4) {
        if (!s4.import_warehouse_id) return toast.error("Vui lòng chọn kho nhập");
        const res = await recycling.complete(ticket.id, s4);
        toast.success("Hoàn thành phiếu. Hao hụt: " + res.loss_qty + " kg");
        onSuccess();
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 1, name: "1. Thông tin", icon: FileText },
    { id: 2, name: "2. Phân loại", icon: Scale },
    { id: 3, name: "3. Nhận cuộn", icon: Package },
    { id: 4, name: "4. Nhập kho", icon: Box },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">
            {ticket ? `Phiếu Tái Chế: ${ticket.ticket_code}` : "Tạo Phiếu Tái Chế Mới"}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
      <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-4">
        {tabs.map((t, idx) => {
          const isActive = step === t.id;
          const isDone = isCompleted || step > t.id;
          const disabled = !ticket && t.id > 1; // Can't click future steps if new
          const Icon = t.icon;
          return (
            <React.Fragment key={t.id}>
              <button 
                disabled={disabled}
                onClick={() => setStep(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? "bg-blue-50 text-blue-700" :
                  isDone ? "text-emerald-600 hover:bg-emerald-50" :
                  "text-slate-400"
                } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Icon size={16}/> {t.name}
              </button>
              {idx < tabs.length - 1 && <ArrowRight size={14} className="text-slate-300" />}
            </React.Fragment>
          );
        })}
      </div>

      <div className="min-h-[300px]">
        {step === 1 && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Ngày xuất</label>
              <input type="date" className={inputCls} value={s1.export_date} onChange={e => setS1({...s1, export_date: e.target.value})} disabled={isCompleted || ticket} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Kho phế phẩm</label>
              <select className={inputCls} value={s1.scrap_warehouse_id} onChange={e => setS1({...s1, scrap_warehouse_id: e.target.value})} disabled={isCompleted || ticket}>
                <option value="">-- Chọn kho --</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Bên thứ 3 (Đơn vị tái chế)</label>
              <input type="text" className={inputCls} value={s1.third_party_name} onChange={e => setS1({...s1, third_party_name: e.target.value})} disabled={isCompleted || ticket} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Số lượng dự kiến (kg)</label>
              <input type="number" className={inputCls} value={s1.expected_qty} onChange={e => setS1({...s1, expected_qty: e.target.value})} disabled={isCompleted || ticket} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-600 mb-1">Ghi chú</label>
              <textarea className={inputCls} value={s1.note} onChange={e => setS1({...s1, note: e.target.value})} disabled={isCompleted || ticket} rows={2}></textarea>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm border border-amber-200">
              Bước này sẽ chốt số lượng cân thực tế và <strong>xuất trừ tồn kho</strong> phế phẩm.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Phế Trong (kg)</label>
                <input type="number" className={inputCls} value={s2.internal_scrap_qty} onChange={e => setS2({...s2, internal_scrap_qty: e.target.value})} disabled={isCompleted || ticket.status !== 'Chờ cân'} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Phế Lẫn (kg)</label>
                <input type="number" className={inputCls} value={s2.mixed_scrap_qty} onChange={e => setS2({...s2, mixed_scrap_qty: e.target.value})} disabled={isCompleted || ticket.status !== 'Chờ cân'} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Người thực hiện cân</label>
                <input type="text" className={inputCls} value={s2.weighing_person} onChange={e => setS2({...s2, weighing_person: e.target.value})} disabled={isCompleted || ticket.status !== 'Chờ cân'} />
              </div>
              <div className="bg-slate-50 p-3 rounded-lg flex flex-col justify-center border border-slate-200">
                <div className="text-sm text-slate-500 font-medium">Tổng thực tế chốt xuất:</div>
                <div className="text-xl font-bold text-rose-600">{(Number(s2.internal_scrap_qty||0) + Number(s2.mixed_scrap_qty||0))} kg</div>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-slate-700">Danh sách cuộn PE nhận về</h3>
              {(!isCompleted && ticket.status === 'Đang tái chế') && (
                <button onClick={() => setRolls([...rolls, { pe_type: 'Cuộn PE', weight: '', note: '' }])} className="btn-ghost text-sm py-1">
                  <Plus size={16}/> Thêm cuộn
                </button>
              )}
            </div>
            <table className="w-full text-sm text-left border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-3 py-2">STT</th>
                  <th className="px-3 py-2">Loại PE</th>
                  <th className="px-3 py-2">Khối lượng (kg)</th>
                  <th className="px-3 py-2">Ghi chú</th>
                  {(!isCompleted && ticket.status === 'Đang tái chế') && <th className="px-3 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {rolls.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">Chưa có cuộn nào</td></tr>
                ) : rolls.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2">{i + 1}</td>
                    <td className="px-3 py-2">
                      <input type="text" className={`${inputCls} py-1`} value={r.pe_type} onChange={e => { const nr=[...rolls]; nr[i].pe_type = e.target.value; setRolls(nr); }} disabled={isCompleted || ticket.status !== 'Đang tái chế'} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" className={`${inputCls} py-1 text-emerald-600 font-bold`} value={r.weight} onChange={e => { const nr=[...rolls]; nr[i].weight = e.target.value; setRolls(nr); }} disabled={isCompleted || ticket.status !== 'Đang tái chế'} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="text" className={`${inputCls} py-1`} value={r.note} onChange={e => { const nr=[...rolls]; nr[i].note = e.target.value; setRolls(nr); }} disabled={isCompleted || ticket.status !== 'Đang tái chế'} />
                    </td>
                    {(!isCompleted && ticket.status === 'Đang tái chế') && (
                      <td className="px-3 py-2">
                        <button onClick={() => { const nr=[...rolls]; nr.splice(i, 1); setRolls(nr); }} className="text-red-500 hover:text-red-700 p-1"><Trash2 size={16}/></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end pt-2">
              <div className="bg-emerald-50 px-4 py-2 rounded-lg border border-emerald-200">
                <span className="text-sm font-semibold text-emerald-800">Tổng PE nhận về: </span>
                <span className="text-lg font-bold text-emerald-600">{rolls.reduce((sum, r) => sum + (Number(r.weight) || 0), 0)} kg</span>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="bg-blue-50 text-blue-800 p-4 rounded-lg text-sm border border-blue-200">
              Xác nhận hoàn thành để hệ thống tạo giao dịch <strong>nhập kho</strong> Bán thành phẩm cho các cuộn PE tái chế.
            </div>
            
            <div className="grid grid-cols-2 gap-6 mt-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="font-semibold text-slate-700 mb-4 border-b border-slate-200 pb-2">Tổng kết khối lượng</h4>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Phế xuất đi:</span>
                    <span className="font-semibold">{ticket.expected_qty} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">PE nhận về:</span>
                    <span className="font-semibold text-emerald-600">{isCompleted ? Number(ticket.total_received_qty) : rolls.reduce((s, r)=>s+(Number(r.weight)||0), 0)} kg</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <span className="text-slate-600 font-bold">Hao hụt (Loss):</span>
                    <span className="font-bold text-rose-600">{Number(ticket.expected_qty) - (isCompleted ? Number(ticket.total_received_qty) : rolls.reduce((s, r)=>s+(Number(r.weight)||0), 0))} kg</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Kho nhập (Kho BTP / NVL)</label>
                <select className={inputCls} value={s4.import_warehouse_id} onChange={e => setS4({...s4, import_warehouse_id: e.target.value})} disabled={isCompleted || ticket.status !== 'Đang tái chế'}>
                  <option value="">-- Chọn kho nhập --</option>
                  {/* Cuộn PE chỉ nhập kho BTP hoặc NVL (backend cũng chặn); phiếu cũ đã chọn kho khác vẫn hiển thị */}
                  {warehouses.filter(w => ['BTP', 'NVL'].includes(w.warehouse_type) || w.id === s4.import_warehouse_id)
                    .map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 pt-4 border-t border-slate-100 flex justify-end gap-3">
        <button onClick={onClose} className="btn-ghost">Đóng</button>
        {(!isCompleted && (
          (step === 1 && !ticket) || 
          (step === 2 && ticket.status === 'Chờ cân') || 
          (step === 3 && ticket.status === 'Đang tái chế') ||
          (step === 4 && ticket.status === 'Đang tái chế')
        )) && (
          <button onClick={nextStep} disabled={loading} className="btn-primary flex items-center gap-2">
            {loading ? "Đang xử lý..." : step === 4 ? <><CheckCircle2 size={16}/> Hoàn thành phiếu</> : "Lưu & Tiếp tục"}
          </button>
        )}
      </div>
      </div>
    </div>
    </div>
  );
}
