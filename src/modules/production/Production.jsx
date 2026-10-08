import React, { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Trash2, ArrowLeft, Save, CalendarClock, Factory, List, GanttChartSquare, Pencil, Printer, GitBranch, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { production, processes } from "../../mesApi.js";
import { usePerm } from "../../perm.jsx";
import { inputCls, fmt, fmtDate, statusClass, toast } from "../../ui.js";
import { PageHeader, Section, ListHeader, DataTable, UnitSelect, SearchSelect } from "../../components.jsx";
import { PackageCheck, CheckCircle2, Lock, RotateCcw } from "lucide-react";
import Qr from "../../Qr.jsx";
import ProductionGantt from "./ProductionGantt.jsx";

const STATUSES = ["Chờ duyệt", "Đã lên kế hoạch", "Chờ nguyên vật liệu", "Đang sản xuất", "Hoàn thành", "Đã hủy"];

/* ---- Form tạo / sửa lệnh sản xuất ---- */
function ProductionForm({ lookups, editId, copyId, onBack, onSaved }) {
  const { can, fperm, isAdmin } = usePerm();
  const fhid = (k) => fperm("production", k) === "hidden";
  const fdis = (k) => fperm("production", k) !== "edit";
  const [f, setF] = useState({
    attr_size: "", attr_thickness: "", attr_color: "", due_date: "", note: "", priority: "Trung bình", material_type: null, mix_ratio: [], status: ""
  });
  const [finishing, setFinishing] = useState(
    (lookups.finishingOptions || []).map((name) => ({ name, checked: false }))
  );
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleFin = (i) => setFinishing((a) => a.map((x, k) => (k === i ? { ...x, checked: !x.checked } : x)));

  // Phân công (lệnh nhỏ): công đoạn + sản lượng + máy + ca + đội
  const [tasks, setTasks] = useState([]);
  const [taskSeq, setTaskSeq] = useState(1);
  const [collapsed, setCollapsed] = useState({}); // { [stage]: true } = đang thu gọn
  const toggleStage = (s) => setCollapsed((c) => ({ ...c, [s]: !c[s] }));
  // Thêm 1 "lần làm" (task con) cho một công đoạn (cha)
  const addTaskFor = (stage) => {
    setCollapsed((c) => ({ ...c, [stage]: false })); // mở nhóm khi thêm lần mới
    setTasks((a) => [...a, { _k: taskSeq, stage, quantity: "", actual_qty: "", scrap_qty: "", machine_id: "", shift: "", planned_date: "", planned_end_date: "", assigned_team: "", assigned_worker: "", assigned_worker_id: "", status: "Chờ" }]);
    setTaskSeq((s) => s + 1);
  };
  const addTask = () => addTaskFor("Thổi");
  const rmTask = (k) => setTasks((a) => a.filter((x) => x._k !== k));
  const upTask = (k, field, v) => setTasks((a) => a.map((x) => (x._k === k ? { ...x, [field]: v } : x)));
  // Đội / Công nhân (chọn từ danh sách, công nhân lọc theo đội)
  const emps = lookups.employees || [];
  const teams = [...new Set(emps.map((e) => e.factory).filter(Boolean))];
  const workersOf = (team) => emps.filter((e) => !team || e.factory === team);
  // Chọn công nhân theo ID; lưu kèm tên để hiển thị
  const setTaskWorker = (k, empId) => setTasks((a) => a.map((x) => x._k === k
    ? { ...x, assigned_worker_id: empId, assigned_worker: emps.find((e) => e.id === empId)?.name || "" } : x));
  const setTaskTeam = (k, v) => setTasks((a) => a.map((x) => {
    if (x._k !== k) return x;
    const keep = emps.find((e) => e.id === x.assigned_worker_id && (!v || e.factory === v));
    return { ...x, assigned_team: v, assigned_worker_id: keep ? x.assigned_worker_id : "", assigned_worker: keep ? x.assigned_worker : "" };
  }));

  // Sinh phân công theo Quy trình công nghệ của sản phẩm (silent = tự động, không báo)
  const genFromProcess = async (productId, quantity, { silent = false, defaults = {} } = {}) => {
    if (!productId) { if (!silent) toast.error("Hãy chọn Sản phẩm trước."); return; }
    try {
      const list = await processes.list({ product_id: productId });
      if (!list.length) { if (!silent) toast.error("Sản phẩm này chưa có quy trình công nghệ. Tạo ở mục Quy trình CN."); return; }
      const proc = await processes.get(list[0].id);
      if (!proc.steps?.length) { if (!silent) toast.error("Quy trình chưa có bước nào."); return; }
      let avail = [];
      try { avail = await production.machineAvailability(); } catch { /* không chặn nếu lỗi */ }
      const mapStage = (s) => /c[ắa]t/i.test(`${s.name || ""} ${s.workshop || ""} ${s.machine_name || ""} ${s.machine_type || ""}`) ? "Cắt" : "Thổi";
      // Gợi ý máy: ưu tiên máy đang rảnh (Hoạt động + tải thấp nhất) và DÙNG 1 MÁY xuyên suốt cho cùng công đoạn
      const chosen = {}; // xưởng/công đoạn -> machine_id đã chọn
      
      const newTasks = [];
      let seq = 1;
      const baseQty = Number(quantity) || 0;
      
      for (const s of proc.steps) {
        const stage = mapStage(s);
        const mids = (s.machine_ids && s.machine_ids.length > 0) ? s.machine_ids : (s.machine_id ? [s.machine_id] : [null]);
        
        // Chia số lượng nếu 1 công đoạn làm trên nhiều máy
        const qtyPerTask = baseQty > 0 ? Math.round(baseQty / mids.length) : "";

        mids.forEach((mId, i) => {
          let chosenMId = mId;
          if (!chosenMId) {
             const wantWs = s.workshop || (stage === "Cắt" ? "Nhà máy cắt" : "Nhà máy thổi");
             if (chosen[wantWs]) chosenMId = chosen[wantWs];
             else {
               let pool = avail.filter((m) => m.status === "Hoạt động" && m.factory === wantWs);
               if (!pool.length) pool = avail.filter((m) => m.status === "Hoạt động" && (stage === "Cắt" ? /c[ắa]t/i.test(`${m.factory} ${m.machine_type}`) : /th[ổô]i/i.test(`${m.factory} ${m.machine_type}`)));
               if (pool.length) { 
                 pool = [...pool].sort((a, b) => (a.load || 0) - (b.load || 0));
                 chosenMId = pool[0].id; chosen[wantWs] = chosenMId; 
               }
             }
          } else {
             chosen[s.workshop || stage] = chosenMId;
          }

          // Máy cuối cùng sẽ ôm phần dư do làm tròn
          const taskQty = (i === mids.length - 1 && baseQty > 0) ? (baseQty - qtyPerTask * (mids.length - 1)) : qtyPerTask;

          // Kế thừa đội/công nhân CHỈ khi cùng nhà máy với công đoạn (1 công nhân chỉ thuộc 1 nhà máy)
          const stageTeam = stage === "Cắt" ? "Nhà máy cắt" : "Nhà máy thổi";
          const teamMatch = defaults.assigned_team && defaults.assigned_team === stageTeam;
          newTasks.push({
            _k: Date.now() + seq, stage, quantity: taskQty, actual_qty: "", scrap_qty: "",
            machine_id: chosenMId || "", shift: defaults.shift || "",
            planned_date: defaults.planned_date || "", planned_end_date: "",
            assigned_team: teamMatch ? defaults.assigned_team : "", assigned_worker: teamMatch ? defaults.assigned_worker : "",
            assigned_worker_id: teamMatch ? (defaults.assigned_worker_id || "") : "",
            status: "Chờ", note: s.name || ""
          });
          seq++;
        });
      }
      setTasks(newTasks); setTaskSeq(Date.now() + seq + 1);
      if (!silent) {
        const nMc = newTasks.filter((t) => t.machine_id).length;
        toast.success(`Đã tạo ${newTasks.length} phân công theo quy trình "${proc.name}". Gợi ý máy rảnh cho ${nMc}/${newTasks.length} công đoạn (ưu tiên 1 máy/công đoạn). Hãy kiểm tra ca/ngày rồi Lưu.`);
      }
    } catch (e) { if (!silent) toast.error("Lỗi: " + e.message); }
  };
  const applyProcess = () => genFromProcess(f.product_id, f.quantity, meta ? {
    defaults: { shift: meta.shift, assigned_team: meta.assigned_team, assigned_worker: meta.assigned_worker, assigned_worker_id: meta.assigned_worker_id, machine_id: meta.machine_id, planned_date: meta.planned_date?.slice(0, 10) },
  } : {});

  // NVL cần cung cấp (kế hoạch cấp NVL) + trạng thái đã yêu cầu (xuất kho)
  const [plannedMats, setPlannedMats] = useState([]);
  const [matsIssued, setMatsIssued] = useState(false);
  const [slip, setSlip] = useState(null); // phiếu xuất kho mới nhất {id, slip_code, status}
  const [pmSeq, setPmSeq] = useState(1);
  const [pmBusy, setPmBusy] = useState(false);
  const nvlOptions = (lookups.products || []).filter((p) => p.product_type === 'Nguyên vật liệu')
    .map((p) => ({ value: p.id, label: `${p.product_name}${p.product_code ? ` (${p.product_code})` : ''}` }));
  const addMat = () => { setPlannedMats((a) => [...a, { _k: pmSeq, material_id: "", ratio: "", qty: "", unit: "", note: "", on_hand: null }]); setPmSeq((s) => s + 1); };
  const rmMat = (k) => setPlannedMats((a) => a.filter((x) => x._k !== k));
  const upMat = (k, field, v) => setPlannedMats((a) => a.map((x) => {
    if (x._k !== k) return x;
    const nx = { ...x, [field]: v };
    if (field === 'material_id') { const p = (lookups.products || []).find((pp) => pp.id === v); nx.unit = p?.unit || x.unit; nx.on_hand = null; }
    return nx;
  }));
  const suggestFromBom = async () => {
    try {
      const d = await production.materials(editId);
      if (!d.has_bom || !d.lines?.length) return toast.error('Sản phẩm chưa có BOM để gợi ý.');
      setPlannedMats(d.lines.map((l, i) => ({ _k: i + 1, material_id: l.material_id, ratio: "", qty: Math.round((l.suggested_qty || 0) * 100) / 100, unit: l.unit || '', note: '', on_hand: l.on_hand })));
      setPmSeq(d.lines.length + 1);
      toast.success(`Đã đổ ${d.lines.length} NVL gợi ý từ BOM. Hãy chỉnh/xóa theo thực tế rồi Lưu.`);
    } catch (e) { toast.error('Lỗi lấy gợi ý BOM: ' + e.message); }
  };
  const requestMats = async () => {
    const lines = plannedMats.filter((m) => m.material_id && Number(m.qty) > 0);
    if (!lines.length) return toast.error('Chưa có NVL cần cung cấp (số kg > 0) để yêu cầu.');
    if (!confirm(`Tạo phiếu xuất kho (Chờ xuất) cho ${lines.length} NVL?\nPhiếu sẽ gửi sang app Xuất kho để xác nhận trừ kho. Danh sách NVL sẽ bị khóa.`)) return;
    setPmBusy(true);
    try {
      const r = await production.requestMaterials(editId, lines);
      toast.success(r.message || 'Đã tạo phiếu xuất kho.');
      setMatsIssued(true);
      loadData();
    } catch (e) { toast.error(e.message); }
    finally { setPmBusy(false); }
  };

  const [editing, setEditing] = useState(!editId); // tạo mới = sửa ngay; mở sẵn = xem
  const [meta, setMeta] = useState(null); // dữ liệu lệnh đã nạp (mã lệnh, SP, đơn...) cho tem QR
  // M40: khoá nút Lưu trong lúc đang gửi (chống bấm 2 lần). Ref chặn ngay lập tức — state chỉ cập nhật
  // sau lần render, 2 cú bấm sát nhau vẫn lọt nếu chỉ dựa vào state.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // Chỉ lệnh Đã hủy mới khóa toàn bộ form. Dòng ĐÃ Hoàn thành khóa riêng từng dòng (bất biến).
  const locked = meta?.status === 'Đã hủy';
  const [rollAvail, setRollAvail] = useState(null);       // tồn cuộn khả dụng ở BTP cho công đoạn Cắt
  const [selCodes, setSelCodes] = useState(() => new Set()); // task_code các dòng đang tích chọn để hoàn thành
  const [completing, setCompleting] = useState(false);
  const [cutModal, setCutModal] = useState(null);         // hộp xác nhận lô cuộn khi hoàn thành dòng Cắt
  const toggleSel = (code) => setSelCodes((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });

  // Nạp dữ liệu khi sửa
  const loadData = useCallback(() => {
    if (!editId) return;
    production.rollAvailability(editId).then(setRollAvail).catch(() => setRollAvail(null));
    production.get(editId).then((d) => {
      setMeta(d);
      setF({
        product_id: d.product_id, customer_id: d.customer_id || "", quantity: d.quantity, unit: d.unit || "",
        attr_size: d.attr_size || "", attr_thickness: d.attr_thickness || "", attr_color: d.attr_color || "",
        due_date: d.due_date?.slice(0, 10) || "", note: d.note || "", priority: d.priority || "Trung bình",
        material_type: d.material_type || null, mix_ratio: d.mix_ratio || [], status: d.status || ""
      });
      const saved = new Map((d.finishing || []).map((x) => [x.name, !!x.checked]));
      const names = [...new Set([...(lookups.finishingOptions || []), ...saved.keys()])];
      setFinishing(names.map((name) => ({ name, checked: saved.get(name) || false })));
      production.getTasks(editId).then((rows) => {
        if (rows && rows.length) {
          setTasks(rows.map((t, i) => ({
            _k: i + 1, id: t.id, task_code: t.task_code, stage: t.stage, quantity: t.quantity, actual_qty: t.actual_qty ?? "", scrap_qty: t.scrap_qty ?? "",
            machine_id: t.machine_id || "", shift: t.shift || "",
            planned_date: t.planned_date?.slice(0, 10) || "", planned_end_date: t.planned_end_date?.slice(0, 10) || "",
            assigned_team: t.assigned_team || "", assigned_worker: t.assigned_worker || "", assigned_worker_id: t.assigned_worker_id || "", status: t.status,
          })));
          setTaskSeq(rows.length + 1);
        } else {
          // Mặc định: chưa có phân công → tự dựng theo quy trình công nghệ, SL = SL lệnh
          // Kế thừa ca/đội/công nhân/máy đã phân bổ ở màn Kế hoạch (lưu ở cấp lệnh)
          genFromProcess(d.product_id, d.quantity, {
            silent: true,
            defaults: { shift: d.shift, assigned_team: d.assigned_team, assigned_worker: d.assigned_worker, assigned_worker_id: d.assigned_worker_id, machine_id: d.machine_id, planned_date: d.planned_date?.slice(0, 10) },
          });
        }
      }).catch(() => {});
      // NVL cần cung cấp + trạng thái đã xuất kho
      production.plannedMaterials(editId).then((pm) => {
        setMatsIssued(!!pm.materials_issued);
        setSlip(pm.slip || null);
        const lines = pm.lines || [];
        const mix = (d.mix_ratio || []).filter((r) => r.material_id);
        if (lines.length) {
          // Đã có NVL cấp → ghép tỷ lệ (%) từ mix_ratio theo material_id
          const ratioBy = {};
          mix.forEach((r) => { ratioBy[r.material_id] = r.ratio; });
          setPlannedMats(lines.map((l, i) => ({ _k: i + 1, material_id: l.material_id, ratio: ratioBy[l.material_id] ?? '', qty: Number(l.qty), unit: l.unit || '', note: l.note || '', on_hand: Number(l.on_hand) })));
          setPmSeq(lines.length + 1);
        } else if (mix.length) {
          // THỪA HƯỞNG từ đơn hàng: chưa có NVL cấp nhưng LSX đã định NVL (mix_ratio từ dòng đơn)
          // → dựng sẵn dòng NVL, điền tỷ lệ, số kg để trống cho người dùng nhập.
          const rows = mix.map((r, i) => {
            const p = (lookups.products || []).find((pp) => pp.id === r.material_id);
            return { _k: i + 1, material_id: r.material_id, ratio: r.ratio ?? '', qty: '', unit: p?.unit || '', note: '', on_hand: null };
          });
          setPlannedMats(rows);
          setPmSeq(rows.length + 1);
        } else {
          setPlannedMats([]);
          setPmSeq(1);
        }
      }).catch(() => {});
    }).catch((e) => toast.error("Lỗi tải lệnh sản xuất: " + e.message));
  }, [editId]); // eslint-disable-line
  useEffect(() => { loadData(); }, [loadData]);

  // Sao chép từ lệnh nguồn → lệnh mới (không copy phân công; sẽ tự dựng theo quy trình khi mở sửa)
  useEffect(() => {
    if (editId || !copyId) return;
    production.get(copyId).then((d) => {
      setF({
        product_id: d.product_id, customer_id: d.customer_id || "", quantity: d.quantity, unit: d.unit || "",
        attr_size: d.attr_size || "", attr_thickness: d.attr_thickness || "", attr_color: d.attr_color || "",
        due_date: d.due_date?.slice(0, 10) || "", note: d.note || "", priority: d.priority || "Trung bình",
        material_type: d.material_type || null, mix_ratio: d.mix_ratio || [], status: ""
      });
      const saved = new Map((d.finishing || []).map((x) => [x.name, !!x.checked]));
      const names = [...new Set([...(lookups.finishingOptions || []), ...saved.keys()])];
      setFinishing(names.map((name) => ({ name, checked: saved.get(name) || false })));
      // Sao chép danh sách NVL + tỷ lệ từ lệnh nguồn (số kg copy theo để chỉnh lại)
      production.plannedMaterials(copyId).then((pm) => {
        const ratioBy = {}; (d.mix_ratio || []).forEach((r) => { if (r.material_id) ratioBy[r.material_id] = r.ratio; });
        const lines = pm.lines || [];
        const rows = lines.length
          ? lines.map((l, i) => ({ _k: i + 1, material_id: l.material_id, ratio: ratioBy[l.material_id] ?? '', qty: Number(l.qty) || '', unit: l.unit || '', note: l.note || '', on_hand: null }))
          : (d.mix_ratio || []).filter((r) => r.material_id).map((r, i) => {
              const p = (lookups.products || []).find((pp) => pp.id === r.material_id);
              return { _k: i + 1, material_id: r.material_id, ratio: r.ratio ?? '', qty: '', unit: p?.unit || '', note: '', on_hand: null };
            });
        setPlannedMats(rows); setPmSeq(rows.length + 1);
      }).catch(() => {});
    }).catch((e) => toast.error("Lỗi tải lệnh nguồn: " + e.message));
  }, [copyId, editId]); // eslint-disable-line

  // auto đổ đơn vị theo sản phẩm + tự dựng phân công theo quy trình (khi tạo mới)
  const onProduct = (id) => {
    const p = lookups.products.find((x) => x.id === id);
    setF((s) => ({ ...s, product_id: id, unit: p?.unit || s.unit }));
    if (!editId && id) genFromProcess(id, f.quantity, { silent: true });
  };
  // đổi SL lệnh → đồng bộ vào các phân công chưa có sản lượng thực tế
  const onQuantity = (v) => {
    setF((s) => ({ ...s, quantity: v }));
    setTasks((a) => a.map((t) => (t.actual_qty === "" || t.actual_qty == null ? { ...t, quantity: v } : t)));
  };

  const save = async () => {
    if (!f.product_id) return toast.error("Vui lòng chọn Sản phẩm");
    if (!f.quantity || Number(f.quantity) <= 0) return toast.error("Vui lòng nhập Số lượng hợp lệ");
    const capQty = Number(f.quantity) * 1.5;
    // Ràng buộc 1: SẢN LƯỢNG (kế hoạch) của TỪNG LẦN không được vượt 150% Số lượng cần sản xuất.
    const overPlan = tasks.filter((t) => t.stage && (Number(t.quantity) || 0) > capQty + 1e-6);
    if (overPlan.length) {
      return toast.error(`Sản lượng một lần không được vượt 150% Số lượng cần sản xuất (${fmt(f.quantity)} → tối đa ${fmt(capQty)}). Có lần vượt: ${overPlan.map((t) => `${t.stage} (${fmt(Number(t.quantity))})`).join(", ")}. Vui lòng xem xét lại sản lượng.`);
    }
    // Ràng buộc 2: Σ SỐ LƯỢNG THỰC TẾ cộng dồn tại dòng cha (mỗi công đoạn) chỉ được vượt
    // tối đa 50% Số lượng cần sản xuất.
    const actualByStage = {};
    tasks.forEach((t) => { if (t.stage) actualByStage[t.stage] = (actualByStage[t.stage] || 0) + (Number(t.actual_qty) || 0); });
    const over = Object.entries(actualByStage).filter(([, s]) => s > capQty + 1e-6);
    if (over.length) {
      return toast.error(`Số lượng thực tế cộng dồn của công đoạn ${over.map(([stg, s]) => `${stg} (${fmt(s)})`).join(", ")} vượt quá 150% Số lượng cần sản xuất (${fmt(f.quantity)} → tối đa ${fmt(capQty)}). Vui lòng xem xét lại số lượng thực tế.`);
    }
    // Ràng buộc 3: khi CHỦ ĐỘNG chọn "Hoàn thành" → tất cả công đoạn phải có đủ máy, ca, đội, công nhân, SL thực tế
    // Không áp khi đang lưu bổ sung thông tin vào lệnh đã ở trạng thái Hoàn thành (để không chặn việc điền thiếu)
    const isSettingCompletion = f.status === 'Hoàn thành' && f.status !== meta?.status;
    if (isSettingCompletion && tasks.length > 0) {
      const missing = tasks.filter((t) => t.stage && (
        !t.machine_id || !t.shift || !t.assigned_team || !t.assigned_worker_id ||
        (t.actual_qty === '' || t.actual_qty == null || Number(t.actual_qty) <= 0)
      ));
      if (missing.length > 0) {
        const details = missing.map((t) => {
          const lacks = [];
          if (!t.machine_id) lacks.push('máy');
          if (!t.shift) lacks.push('ca');
          if (!t.assigned_team) lacks.push('đội');
          if (!t.assigned_worker_id) lacks.push('công nhân');
          if (!t.actual_qty || Number(t.actual_qty) <= 0) lacks.push('SL thực tế');
          return `${t.stage} (thiếu: ${lacks.join(', ')})`;
        }).join('; ');
        return toast.error(`Không thể xác nhận Hoàn thành — các công đoạn sau chưa đủ thông tin: ${details}. Vui lòng gán đủ máy, ca, đội, công nhân và nhập sản lượng thực tế.`);
      }
    }
    // Tỷ lệ (%) ở bảng NVL gộp → đồng bộ về mix_ratio (cấp lệnh); Số KG lưu riêng ở savePlannedMaterials.
    const mixRatio = plannedMats.filter((m) => m.material_id).map((m) => ({ material_id: m.material_id, ratio: m.ratio === '' || m.ratio == null ? null : Number(m.ratio) }));
    const matLines = plannedMats.filter((m) => m.material_id);
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (editId) {
        // Status: chỉ áp khi người dùng CHỦ ĐỘNG đổi (khác trạng thái đã nạp).
        const statusChanged = f.status && f.status !== meta?.status;
        const { status, ...rest } = f;
        await production.update(editId, { ...rest, mix_ratio: mixRatio, finishing }); // các trường (kể cả SL mới), chưa đụng status
        await production.saveTasks(editId, tasks.filter((t) => t.stage)); // recompute status theo tiến độ + SL mới
        if (statusChanged) await production.update(editId, { status });   // áp status thủ công cuối cùng → thắng recompute
        if (!matsIssued) await production.savePlannedMaterials(editId, matLines);
        toast.success("Lưu lệnh sản xuất thành công");
        setEditing(false); // Ở LẠI màn chi tiết (không thoát ra list)
        loadData();        // nạp lại dữ liệu vừa lưu
      } else {
        // Tạo mới: lưu NVL (mix_ratio + material_type) cùng lệnh, rồi lưu số kg NVL cấp
        const created = await production.create({ ...f, mix_ratio: mixRatio, finishing });
        if (created?.id && matLines.length) await production.savePlannedMaterials(created.id, matLines);
        toast.success("Tạo lệnh sản xuất mới thành công");
        onSaved(); // tạo mới → về list
      }
    } catch (e) { toast.error("Lỗi lưu lệnh sản xuất: " + e.message); }
    finally { savingRef.current = false; setSaving(false); }
  };

  // ===== Hoàn thành dòng phân công (thiết kế cuộn BTP) =====
  // Kiểm tra các dòng (theo task_code) đã đủ máy / công nhân / SL thực chưa.
  const validateForComplete = (codes) => {
    const rows = tasks.filter((t) => codes.includes(t.task_code));
    const missing = rows.filter((t) => !t.machine_id || !(t.assigned_worker_id || t.assigned_worker) || !(Number(t.actual_qty) > 0));
    if (missing.length) {
      const details = missing.map((t) => {
        const lacks = [];
        if (!t.machine_id) lacks.push('máy');
        if (!(t.assigned_worker_id || t.assigned_worker)) lacks.push('công nhân');
        if (!(Number(t.actual_qty) > 0)) lacks.push('SL thực');
        return `${t.stage} (${lacks.join(', ')})`;
      }).join('; ');
      toast.error(`Chưa đủ điều kiện hoàn thành: ${details}. Vui lòng điền đủ rồi thử lại.`);
      return false;
    }
    return true;
  };

  // Bắt đầu hoàn thành: nếu có dòng Cắt → mở hộp xác nhận lô cuộn; nếu không → hoàn thành ngay.
  const startComplete = async (codes) => {
    codes = codes.filter((c) => c); // bỏ dòng chưa lưu (chưa có task_code)
    if (!codes.length) return toast.error('Chưa chọn dòng nào đã lưu để hoàn thành. Hãy "Lưu phân công" trước.');
    if (!validateForComplete(codes)) return;
    const hasCut = tasks.some((t) => codes.includes(t.task_code) && t.stage === 'Cắt');
    if (hasCut) {
      try {
        const info = await production.rollAvailability(editId);
        setCutModal({ codes, lots: info.lots || [], finish: new Set(), spec_label: info.spec_label, total_kg: info.total_kg });
      } catch (e) { toast.error('Lỗi tải tồn cuộn: ' + e.message); }
    } else {
      finishComplete(codes, []);
    }
  };

  // Gọi API: lưu nháp (giữ task_code) rồi hoàn thành. Lô "đã hết cuộn" gắn vào dòng Cắt cuối cùng.
  const finishComplete = async (codes, finishLots) => {
    if (completing) return;
    setCompleting(true);
    try {
      await production.saveTasks(editId, tasks.filter((t) => t.stage));
      const cutCodes = tasks.filter((t) => codes.includes(t.task_code) && t.stage === 'Cắt').map((t) => t.task_code);
      const blowCodes = codes.filter((c) => !cutCodes.includes(c));
      const items = [
        ...blowCodes.map((c) => ({ task_code: c })),
        ...cutCodes.map((c, i) => ({ task_code: c, roll_finish_lots: i === cutCodes.length - 1 ? finishLots : [] })),
      ];
      await production.completeTasks(editId, items);
      toast.success(`Đã hoàn thành ${codes.length} dòng phân công`);
      setSelCodes(new Set()); setCutModal(null); loadData();
    } catch (e) { toast.error('Lỗi hoàn thành: ' + e.message); }
    finally { setCompleting(false); }
  };

  // Admin hủy hoàn thành 1 dòng
  const reopenRow = async (taskId) => {
    if (!taskId) return;
    if (!confirm('Hủy hoàn thành dòng này và hoàn kho về đúng như đã ghi?')) return;
    try { await production.reopenTask(taskId); toast.success('Đã hủy hoàn thành dòng'); loadData(); }
    catch (e) { toast.error('Lỗi hủy hoàn thành: ' + e.message); }
  };

  const del = async () => {
    if (!confirm("Xóa lệnh sản xuất này?")) return;
    try { await production.remove(editId); toast.success("Đã xóa lệnh sản xuất thành công"); onSaved(); } catch (e) { toast.error("Lỗi xóa: " + e.message); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={<span className="inline-flex items-center gap-2 flex-wrap">
          {!editId ? (copyId ? "Tạo lệnh sản xuất (sao chép)" : "Tạo lệnh sản xuất") : editing ? "Sửa lệnh sản xuất" : "Chi tiết lệnh sản xuất"}
          {meta?.order_code && <span className="text-slate-400 font-normal">· {meta.order_code}</span>}
          {editId && meta?.status && <span className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-medium ${statusClass(meta.status)}`}>{meta.status}</span>}
        </span>} onBack={onBack}
        actions={editId && !editing ? (<>
          {locked && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">🔒 Đã {meta?.status} · không thể sửa</span>}
          {meta?.status === 'Hoàn thành' && !locked && <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">⚠ Hoàn thành · cần bổ sung phân công</span>}
          {can("production", "edit") && !matsIssued && !locked && <button onClick={requestMats} disabled={pmBusy} className="btn-ghost text-amber-700 border-amber-300 hover:bg-amber-50"><PackageCheck size={16} /> Yêu cầu NVL</button>}
          {can("production", "edit") && !locked && <button onClick={() => setEditing(true)} className="btn-ghost"><Pencil size={16} /> Sửa</button>}
          {can("production", "delete") && <button onClick={del} className="btn-ghost" style={{ color: "#e11d48" }}><Trash2 size={16} /> Xóa</button>}
        </>) : (<>
          {editId && <button onClick={() => { setEditing(false); loadData(); }} className="btn-ghost">Hủy</button>}
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"><Save size={16} /> {saving ? "Đang lưu..." : "Lưu lệnh sản xuất"}</button>
        </>)} />

      <fieldset disabled={!editing} className="space-y-5">
      <Section title="Thông tin sản xuất cơ bản">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          {!fhid("product_id") && <Field label="Sản phẩm" required>
            <SearchSelect
              value={f.product_id}
              onChange={onProduct}
              options={lookups.products.map((p) => ({ value: p.id, label: `${p.product_code} · ${p.product_name}` }))}
              placeholder="-- Chọn sản phẩm --"
              disabled={fdis("product_id")}
            />
          </Field>}
          {!fhid("customer_id") && <Field label="Khách hàng">
            <select className={inputCls} disabled={fdis("customer_id")} value={f.customer_id} onChange={(e) => set("customer_id", e.target.value)}>
              <option value="">-- Không / Khách lẻ --</option>
              {lookups.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>}
          {!fhid("quantity") && <Field label="Số lượng cần sản xuất" required>
            <input type="number" min="0" className={inputCls} disabled={fdis("quantity")} value={f.quantity} onChange={(e) => onQuantity(e.target.value)} />
          </Field>}
          <Field label="Đơn vị">
            <UnitSelect value={f.unit} onChange={(v) => set("unit", v)} />
          </Field>
          <Field label="Ngày giao (deadline)">
            <input type="date" className={inputCls} value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />
          </Field>
          {!fhid("priority") && <Field label="Độ ưu tiên">
            <select className={inputCls} disabled={fdis("priority")} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="Cao">Cao (Gấp)</option>
              <option value="Trung bình">Trung bình</option>
              <option value="Thấp">Thấp</option>
            </select>
          </Field>}
          {editId && <Field label="Trạng thái">
            {/* 'Hoàn thành' được suy ra tự động khi hoàn thành các dòng phân công — không đặt tay ở đây. */}
            <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}>
              {!f.status && <option value="">-- Chọn trạng thái --</option>}
              {STATUSES.filter((s) => s !== 'Hoàn thành' || f.status === 'Hoàn thành').map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {f.status === 'Hoàn thành' && <p className="text-xs text-slate-400 mt-1">Lệnh đã Hoàn thành (tự động theo sản lượng). Dùng "Hủy hoàn thành" trên từng dòng nếu cần sửa.</p>}
          </Field>}
          <Field label="Ghi chú">
            <input className={inputCls} value={f.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
        </div>
        
      </Section>

      {editId && meta && (() => {
        const target = Number(f.quantity) || 0;
        const produced = Number(meta.produced_qty) || 0;
        const pctDone = target > 0 ? Math.min(100, Math.round((produced / target) * 100)) : 0;
        const remain = Math.max(0, target - produced);
        const stat = (label, value, sub, cls = "text-slate-800") => (
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className={`text-2xl font-bold ${cls}`}>{value}</div>
            {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
          </div>
        );
        return (
          <Section title="Kết quả thực tế">
            {/* Phế không ghi theo lệnh — chỉ thống kê ở màn Phế phẩm (Áp phế). */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {stat("Trạng thái", <span className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-medium ${statusClass(meta.status)}`}>{meta.status}</span>, `${meta.task_done || 0}/${meta.task_count || 0} việc xong`)}
              {stat("Số lượng cần SX", fmt(target), f.unit)}
              {stat("Đã sản xuất", fmt(produced), `Còn lại ${fmt(remain)} ${f.unit || ""}`, pctDone >= 100 ? "text-emerald-600" : "text-blue-600")}
              {stat("% đã sản xuất", pctDone + "%", null, pctDone >= 100 ? "text-emerald-600" : "text-blue-600")}
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Tiến độ sản xuất</span><span>{fmt(produced)}/{fmt(target)} {f.unit}</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${pctDone >= 100 ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${Math.max(pctDone, 2)}%` }} />
              </div>
            </div>
          </Section>
        );
      })()}

      {!fhid("attributes") && (
      <Section title={<>Thông số đặc thù <span className="text-slate-400 font-normal">(kế thừa xuyên suốt)</span></>}>
        <fieldset disabled={fdis("attributes")}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Field label="Chiều ngang (Rộng) (Cm)">
            <input className={inputCls} list="widths" value={(f.attr_size || "").split(/x|×/i)[0]?.trim() || ""} onChange={(e) => {
              const d = (f.attr_size || "").split(/x|×/i)[1]?.trim() || "";
              set("attr_size", e.target.value ? `${e.target.value} × ${d}` : (d ? ` × ${d}` : ""));
            }} placeholder="vd: 20" />
            <datalist id="widths">{(lookups.sizes || []).map((s) => <option key={s} value={s.split(/x|×/i)[0]?.trim()} />)}</datalist>
          </Field>
          <Field label="Chiều dài (Cm)">
            <input className={inputCls} value={(f.attr_size || "").split(/x|×/i)[1]?.trim() || ""} onChange={(e) => {
              const r = (f.attr_size || "").split(/x|×/i)[0]?.trim() || "";
              set("attr_size", e.target.value ? `${r} × ${e.target.value}` : (r ? `${r} × ` : ""));
            }} placeholder="vd: 30" />
          </Field>
          <Field label="Độ dày">
            <input className={inputCls} list="thicknesses" value={f.attr_thickness} onChange={(e) => set("attr_thickness", e.target.value)} placeholder="vd: 20mic" />
            <datalist id="thicknesses">{(lookups.thicknesses || []).map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Màu sắc">
            <input className={inputCls} list="colors" value={f.attr_color} onChange={(e) => set("attr_color", e.target.value)} placeholder="vd: Trắng sữa" />
            <datalist id="colors">{(lookups.colors || []).map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
        </div>
        </fieldset>
      </Section>
      )}

      <Section title="Nguyên vật liệu cần cung cấp"
        action={<div className="flex items-center gap-2">
          {matsIssued
            ? (slip?.status === 'Đã xuất'
                ? <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"><PackageCheck size={14} /> Đã xuất kho{slip?.slip_code ? ` · ${slip.slip_code}` : ''}</span>
                : <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"><PackageCheck size={14} /> Chờ xuất kho{slip?.slip_code ? ` · ${slip.slip_code}` : ''}</span>)
            : (editing && <>
                {editId && <button type="button" onClick={suggestFromBom} className="btn-ghost text-blue-600 border-blue-200 hover:bg-blue-50"><GitBranch size={16} /> Lấy gợi ý từ BOM</button>}
                <button type="button" onClick={addMat} className="btn-ghost text-blue-600 border-blue-200 hover:bg-blue-50"><Plus size={16} /> Thêm NVL</button>
              </>)}
        </div>}>
        {/* Loại nguyên liệu (gộp vào mục NVL) */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Loại nguyên liệu</p>
          <div className="flex gap-4 flex-wrap">
            <label className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 cursor-pointer transition-all select-none ${
              f.material_type === 'zin'
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            } ${editing ? '' : 'cursor-default pointer-events-none'}`}>
              <input type="checkbox" className="hidden" disabled={!editing}
                checked={f.material_type === 'zin'}
                onChange={() => set("material_type", f.material_type === 'zin' ? null : 'zin')} />
              <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                f.material_type === 'zin' ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'
              }`}>
                {f.material_type === 'zin' && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 16 16"><path d="M13.485 1.431a1.473 1.473 0 0 1 2.104 2.062l-7.84 9.801a1.473 1.473 0 0 1-2.12.04L.431 8.138a1.473 1.473 0 0 1 2.084-2.083l4.111 4.112 6.82-8.69a.486.486 0 0 1 .04-.046z"/></svg>}
              </span>
              <span className="text-sm font-medium">Hàng zin</span>
              <span className="text-xs text-slate-400">(100% nhựa nguyên sinh)</span>
            </label>
            <label className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 cursor-pointer transition-all select-none ${
              f.material_type === 'pha'
                ? 'border-amber-500 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            } ${editing ? '' : 'cursor-default pointer-events-none'}`}>
              <input type="checkbox" className="hidden" disabled={!editing}
                checked={f.material_type === 'pha'}
                onChange={() => set("material_type", f.material_type === 'pha' ? null : 'pha')} />
              <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                f.material_type === 'pha' ? 'border-amber-500 bg-amber-500' : 'border-slate-300'
              }`}>
                {f.material_type === 'pha' && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 16 16"><path d="M13.485 1.431a1.473 1.473 0 0 1 2.104 2.062l-7.84 9.801a1.473 1.473 0 0 1-2.12.04L.431 8.138a1.473 1.473 0 0 1 2.084-2.083l4.111 4.112 6.82-8.69a.486.486 0 0 1 .04-.046z"/></svg>}
              </span>
              <span className="text-sm font-medium">Hàng pha</span>
              <span className="text-xs text-slate-400">(tái chế)</span>
            </label>
            {f.material_type && editing && (
              <button type="button" onClick={() => set("material_type", null)}
                className="text-xs text-slate-400 hover:text-slate-600 underline self-center">
                Bỏ chọn
              </button>
            )}
          </div>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-slate-100/50 border-b border-slate-200 text-slate-600 font-semibold text-xs">
                <th className="px-3 py-2.5 w-12 text-center uppercase tracking-wider">STT</th>
                <th className="px-3 py-2.5 uppercase tracking-wider">Nguyên vật liệu</th>
                <th className="px-3 py-2.5 w-24 uppercase tracking-wider">Tỷ lệ (%)</th>
                <th className="px-3 py-2.5 w-28 uppercase tracking-wider">Số kg</th>
                <th className="px-3 py-2.5 w-24 uppercase tracking-wider">ĐVT</th>
                <th className="px-3 py-2.5 w-28 uppercase tracking-wider">Tồn kho</th>
                <th className="px-3 py-2.5 uppercase tracking-wider">Ghi chú</th>
                {editing && !matsIssued && <th className="px-3 py-2.5 w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {plannedMats.length === 0 && (
                <tr><td colSpan={editing && !matsIssued ? 8 : 7} className="px-3 py-4 text-center text-slate-400 bg-white">Chưa có NVL. {editing && !matsIssued ? 'Bấm “Lấy gợi ý từ BOM” hoặc “Thêm NVL”.' : ''}</td></tr>
              )}
              {plannedMats.map((r, i) => {
                const short = r.on_hand != null && Number(r.qty) > Number(r.on_hand);
                return (
                <tr key={r._k} className="border-b border-slate-100 last:border-0 bg-white align-top">
                  <td className="px-3 py-2.5 text-center text-slate-500 font-medium">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    {editing && !matsIssued
                      ? <SearchSelect value={r.material_id} onChange={(v) => upMat(r._k, 'material_id', v)} options={nvlOptions} placeholder="-- Chọn NVL --" />
                      : <span className="font-medium text-slate-700">{nvlOptions.find((o) => o.value === r.material_id)?.label || '—'}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {editing && !matsIssued
                      ? <input type="number" min="0" step="any" className={inputCls} value={r.ratio ?? ''} onChange={(e) => upMat(r._k, 'ratio', e.target.value)} placeholder="%" />
                      : <span className="font-medium">{r.ratio != null && r.ratio !== '' ? `${r.ratio}%` : '—'}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {editing && !matsIssued
                      ? <input type="number" min="0" step="any" className={inputCls} value={r.qty} onChange={(e) => upMat(r._k, 'qty', e.target.value)} placeholder="kg" />
                      : <span className="font-medium">{fmt(r.qty)}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {editing && !matsIssued
                      ? <input className={inputCls} value={r.unit} onChange={(e) => upMat(r._k, 'unit', e.target.value)} placeholder="kg" />
                      : <span className="text-slate-600">{r.unit || 'kg'}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.on_hand == null
                      ? <span className="text-slate-400 text-xs">— lưu để xem</span>
                      : <span className={short ? 'text-rose-600 font-semibold' : 'text-slate-700'}>{fmt(r.on_hand)}{short && <span className="block text-[11px] font-normal">thiếu {fmt(Number(r.qty) - Number(r.on_hand))}</span>}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {editing && !matsIssued
                      ? <input className={inputCls} value={r.note} onChange={(e) => upMat(r._k, 'note', e.target.value)} placeholder="ghi chú" />
                      : <span className="text-slate-500">{r.note || ''}</span>}
                  </td>
                  {editing && !matsIssued && (
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => rmMat(r._k)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"><Trash2 size={15} /></button>
                    </td>
                  )}
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </Section>

      {false /* !fhid("finishing") */ && (
      <Section title="Yêu cầu gia công hoàn thiện">
        <fieldset disabled={fdis("finishing")}>
        <div className="flex flex-wrap gap-3">
          {finishing.map((x, i) => (
            <label key={x.name} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition ${
              x.checked ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              <input type="checkbox" checked={x.checked} onChange={() => toggleFin(i)} className="w-4 h-4 accent-blue-600" />
              {x.name}
            </label>
          ))}
        </div>
        </fieldset>
      </Section>
      )}

      {editId && !fhid("tasks") && (
        <Section title="Phân công sản xuất — chia lệnh nhỏ (công đoạn + sản lượng)"
          action={!fdis("tasks") && !locked && (
            <button type="button" disabled={completing || !selCodes.size}
              onClick={() => startComplete([...selCodes])}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              <CheckCircle2 size={15} /> Hoàn thành các dòng đã chọn{selCodes.size ? ` (${selCodes.size})` : ''}
            </button>
          )}>
          <fieldset disabled={fdis("tasks")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left py-2 font-medium min-w-[110px]">Công đoạn</th>
                  <th className="text-left py-2 font-medium min-w-[110px]">Sản lượng</th>
                  <th className="text-left py-2 font-medium min-w-[180px]">Máy</th>
                  <th className="text-left py-2 font-medium min-w-[100px]">Ca</th>
                  <th className="text-left py-2 font-medium min-w-[140px]">Từ ngày</th>
                  <th className="text-left py-2 font-medium min-w-[140px]">Đến ngày</th>
                  <th className="text-left py-2 font-medium min-w-[130px]">Đội</th>
                  <th className="text-left py-2 font-medium min-w-[160px]">Công nhân</th>
                  <th className="text-left py-2 font-medium min-w-[100px]">Thực tế</th>
                  <th className="text-left py-2 font-medium min-w-[150px]">Trạng thái</th>
                  <th className="text-center py-2 font-medium min-w-[120px]">Hoàn thành</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const order = ["Thổi", "Cắt"];
                  const present = [...new Set(tasks.map((t) => t.stage))].sort(
                    (a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b))
                  );
                  return present.map((stg) => {
                    const rows = tasks.filter((t) => t.stage === stg);
                    const factory = stg === "Thổi" ? "Nhà máy thổi" : "Nhà máy cắt";
                    const machinesForStage = lookups.machines.filter((m) => m.factory === factory);
                    const sumQty = rows.reduce((s, t) => s + (Number(t.quantity) || 0), 0);
                    const sumAct = rows.reduce((s, t) => s + (Number(t.actual_qty) || 0), 0);
                    const qtyReq = Number(f.quantity);
                    const capStage = qtyReq * 1.5;             // ngưỡng 150% cho SL THỰC TẾ → chặn khi Lưu
                    const actOver = sumAct > capStage + 1e-6;  // Σ thực tế vượt 150%
                    const actMet = !actOver && qtyReq > 0 && sumAct >= qtyReq - 1e-6; // đã đạt SL cần SX
                    const isOpen = !collapsed[stg];
                    return (
                      <React.Fragment key={stg}>
                        {/* Dòng CHA: công đoạn + tổng sản lượng dồn từ các lần — bấm để gập/mở */}
                        <tr className="bg-slate-50 border-y border-slate-200">
                          <td className="py-2 pr-2 font-semibold text-slate-800 cursor-pointer select-none" onClick={() => toggleStage(stg)}>
                            <span className="inline-flex items-center gap-1.5">
                              {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                              {stg}
                            </span>
                          </td>
                          {/* SẢN LƯỢNG (kế hoạch): tổng cho phép các lần — trung tính, không ràng buộc */}
                          <td className="py-2 pr-2 font-medium text-slate-500 cursor-pointer" onClick={() => toggleStage(stg)} title="Tổng sản lượng cho phép của các lần (kế hoạch)">Σ KH {fmt(sumQty)}</td>
                          <td colSpan={6} className="cursor-pointer py-2 pr-2" onClick={() => toggleStage(stg)}>
                            {stg === "Cắt" && rollAvail && (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-0.5">
                                🧵 Tồn cuộn khả dụng: {fmt(rollAvail.total_kg)} kg ({rollAvail.spec_label})
                              </span>
                            )}
                          </td>
                          {/* THỰC TẾ: total cộng dồn so với SL cần SX — ràng buộc ≤ 150% */}
                          <td className={`py-2 pr-2 font-semibold ${actOver ? "text-rose-600" : actMet ? "text-emerald-600" : "text-slate-600"}`} title={actOver ? `Vượt 150% SL cần SX (tối đa ${fmt(capStage)})` : undefined}>Σ {fmt(sumAct)} / {fmt(qtyReq)}{actOver ? " ⚠ >150%" : actMet ? " ✓" : ""}</td>
                          <td className="py-2 pr-2 text-right" colSpan={3}>
                            {!fdis("tasks") && <button type="button" onClick={() => addTaskFor(stg)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-white text-blue-600 text-xs font-medium hover:bg-blue-50 hover:border-blue-300 shadow-sm transition-colors"><Plus size={15} /> Thêm lần {stg.toLowerCase()}</button>}
                          </td>
                        </tr>
                        {/* Các dòng CON: từng lần làm (ẩn khi thu gọn) */}
                        {isOpen && rows.map((t) => {
                          const qtyOver = (Number(t.quantity) || 0) > capStage + 1e-6; // sản lượng 1 lần vượt 150%
                          const rowLocked = t.status === 'Hoàn thành'; // dòng đã hoàn thành: bất biến
                          const dis = rowLocked; // khóa mọi ô nhập
                          return (
                          <tr key={t._k} className={`border-b border-slate-100${rowLocked ? " bg-emerald-50/40" : ""}`}>
                            <td className="py-1.5 pr-2 pl-8">{rowLocked && <Lock size={13} className="text-emerald-600 inline" />}</td>
                            <td className="py-1.5 pr-2"><input disabled={dis} type="number" min="0" className={`${inputCls}${qtyOver ? " !border-rose-400 !ring-2 !ring-rose-200" : ""}`} value={t.quantity} onChange={(e) => upTask(t._k, "quantity", e.target.value)} title={qtyOver ? `Sản lượng 1 lần vượt 150% SL cần SX (tối đa ${fmt(capStage)})` : undefined} /></td>
                            <td className="py-1.5 pr-2"><select disabled={dis} className={inputCls} value={t.machine_id} onChange={(e) => upTask(t._k, "machine_id", e.target.value)}><option value="">-- Chọn máy --</option>{machinesForStage.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></td>
                            <td className="py-1.5 pr-2"><select disabled={dis} className={inputCls} value={t.shift} onChange={(e) => upTask(t._k, "shift", e.target.value)}><option value="">--</option>{(lookups.shifts || []).map((c) => <option key={c}>{c}</option>)}</select></td>
                            <td className="py-1.5 pr-2"><input disabled={dis} type="date" className={inputCls} value={t.planned_date} onChange={(e) => upTask(t._k, "planned_date", e.target.value)} /></td>
                            <td className="py-1.5 pr-2"><input disabled={dis} type="date" className={inputCls} value={t.planned_end_date} onChange={(e) => upTask(t._k, "planned_end_date", e.target.value)} /></td>
                            <td className="py-1.5 pr-2">
                              <select disabled={dis} className={inputCls} value={t.assigned_team} onChange={(e) => setTaskTeam(t._k, e.target.value)}>
                                <option value="">-- Đội --</option>
                                {teams.map((tm) => <option key={tm}>{tm}</option>)}
                              </select>
                            </td>
                            <td className="py-1.5 pr-2">
                              <select disabled={dis} className={inputCls} value={t.assigned_worker_id || ""} onChange={(e) => setTaskWorker(t._k, e.target.value)}>
                                <option value="">-- Công nhân --</option>
                                {workersOf(t.assigned_team).map((e) => <option key={e.id} value={e.id}>{e.employee_code ? `${e.employee_code} · ` : ""}{e.name}</option>)}
                              </select>
                            </td>
                            <td className="py-1.5 pr-2"><input disabled={dis} type="number" min="0" className={inputCls} value={t.actual_qty} onChange={(e) => upTask(t._k, "actual_qty", e.target.value)} placeholder="SL thực" /></td>
                            <td className="py-1.5 pr-2">
                              {rowLocked
                                ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">Hoàn thành</span>
                                : <select disabled={dis} className={inputCls} value={t.status === 'Hoàn thành' ? 'Chờ' : t.status} onChange={(e) => upTask(t._k, "status", e.target.value)}><option>Chờ</option><option>Đang sản xuất</option><option>Dừng sản xuất</option><option>Đã hủy</option></select>}
                            </td>
                            <td className="py-1.5 pr-2 text-center">
                              {rowLocked
                                ? (isAdmin && !fdis("tasks") && <button type="button" onClick={() => reopenRow(t.id)} className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800" title="Hủy hoàn thành (Admin)"><RotateCcw size={14} /> Hủy HT</button>)
                                : (!fdis("tasks") && !locked && (
                                  <div className="inline-flex items-center gap-2">
                                    <input type="checkbox" title="Chọn để hoàn thành nhiều dòng" disabled={!t.task_code}
                                      checked={selCodes.has(t.task_code)} onChange={() => t.task_code && toggleSel(t.task_code)} />
                                    <button type="button" disabled={completing || !t.task_code} onClick={() => startComplete([t.task_code])}
                                      className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 disabled:opacity-40" title={t.task_code ? "Hoàn thành dòng này" : "Lưu phân công trước"}>
                                      <CheckCircle2 size={14} /> HT
                                    </button>
                                  </div>
                                ))}
                            </td>
                            <td className="py-1.5 text-center">{!rowLocked && <button disabled={dis} onClick={() => rmTask(t._k)} className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={16} /></button>}</td>
                          </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  });
                })()}
                {!tasks.length && <tr><td colSpan={12} className="py-4 text-center text-slate-400 text-sm">Chưa có phân công. Bấm "＋ Thổi" hoặc "＋ Cắt" để thêm lần làm.</td></tr>}
              </tbody>
            </table>
          </div>
          <datalist id="emp-dl">{(lookups.employees || []).map((e) => <option key={e.id} value={e.name} />)}</datalist>
          </fieldset>
        </Section>
      )}
      </fieldset>

      {/* Hộp xác nhận lô cuộn khi hoàn thành công đoạn Cắt */}
      {cutModal && (() => {
        const cutQty = tasks.filter((t) => cutModal.codes.includes(t.task_code) && t.stage === 'Cắt').reduce((s, t) => s + (Number(t.actual_qty) || 0), 0);
        const enough = cutModal.total_kg >= cutQty - 1e-6;
        return (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">Hoàn thành Cắt — trừ cuộn BTP</h2>
              <button onClick={() => setCutModal(null)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <div className="p-4 overflow-y-auto space-y-3 text-sm">
              <p>Thông số: <b>{cutModal.spec_label}</b></p>
              <p>Cần cắt: <b>{fmt(cutQty)} kg</b> · Tồn cuộn khả dụng: <b className={enough ? "text-emerald-600" : "text-rose-600"}>{fmt(cutModal.total_kg)} kg</b></p>
              {!enough && <p className="text-rose-600 font-medium">⚠ Không đủ cuộn để cắt — hệ thống sẽ chặn khi xác nhận.</p>}
              <p className="text-slate-500">Các lô sẽ bị trừ (ưu tiên lô của lệnh rồi FIFO). Tích <b>"Đã hết cuộn"</b> để xóa phần kg dư của lô sau khi cắt (ghi "Điều chỉnh – Hao hụt cắt"):</p>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {cutModal.lots.length === 0 && <div className="p-3 text-slate-400">Không có lô cuộn khớp thông số.</div>}
                {cutModal.lots.map((lot) => (
                  <label key={lot.lot_code} className="flex items-center justify-between gap-3 p-2.5 cursor-pointer hover:bg-slate-50">
                    <span>
                      <b>{lot.lot_code}</b>{lot.is_own ? <span className="ml-1 text-xs text-indigo-600">(lô của lệnh)</span> : ""}
                      <span className="text-slate-500"> · {lot.location} · {fmt(lot.qty)} kg</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={cutModal.finish.has(lot.lot_code)}
                        onChange={() => setCutModal((m) => { const f = new Set(m.finish); f.has(lot.lot_code) ? f.delete(lot.lot_code) : f.add(lot.lot_code); return { ...m, finish: f }; })} />
                      Đã hết cuộn
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-lg">
              <button onClick={() => setCutModal(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg">Hủy</button>
              <button onClick={() => finishComplete(cutModal.codes, [...cutModal.finish])} disabled={completing}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-60 flex items-center gap-2">
                <CheckCircle2 size={16} /> {completing ? "Đang xử lý..." : "Xác nhận hoàn thành"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {false /* editId */ && (
        <Section title="Mã truy xuất các lô"
          action={tasks.some((t) => t.task_code) && <button onClick={() => window.print()} className="btn-ghost"><Printer size={16} /> In danh sách</button>}>
          <div className="po-qr-area flex flex-wrap gap-3">
            {tasks.filter((t) => t.task_code).map((t) => (
              <div key={t._k} className="label-card flex flex-col gap-2 border border-slate-300 rounded-lg p-3 bg-white" style={{ width: 220 }}>
                <div className="text-[12px] leading-snug text-slate-700 min-w-0">
                  <div className="font-semibold text-slate-800">{t.task_code}</div>
                  <div className="text-slate-400">{meta?.order_code} · {t.stage} ({t.stage === "Cắt" ? "TP" : "BTP"})</div>
                  <div className="truncate">{meta?.product_name}</div>
                  <div>{[meta?.attr_color, meta?.attr_size, meta?.attr_thickness].filter(Boolean).join(" · ") || "—"}</div>
                  <div>SL: <b>{fmt(t.quantity)} {meta?.unit}</b></div>
                  <div className="text-slate-400">{fmtDate(t.planned_date)}</div>
                </div>
              </div>
            ))}
            {!tasks.some((t) => t.task_code) && <p className="text-sm text-slate-400">Chưa có lô. Thêm phân công và Lưu để sinh tem QR cho từng lô.</p>}
          </div>
          <style>{`@media print { body * { visibility:hidden!important; } .po-qr-area, .po-qr-area * { visibility:visible!important; } .po-qr-area { position:absolute; left:0; top:0; } .label-card { break-inside:avoid; } }`}</style>
        </Section>
      )}
    </div>
  );
}

const Field = ({ label, required, children }) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
  </div>
);

/* ---- Module chính ---- */
/* ---- Modal lập lịch (popup) ---- */
export function ScheduleModal({ lookups, order, onClose, onSaved }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    production.getTasks(order.id).then((d) => {
      setTasks(d);
      setLoading(false);
    }).catch(e => { toast.error("Lỗi tải phân công: " + e.message); onClose(); });
  }, [order.id, onClose]);

  const [saving, setSaving] = useState(false); // M40: chống bấm "Lưu thay đổi" 2 lần
  const savingRef = useRef(false);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await production.saveTasks(order.id, tasks.filter(t => t.stage));
      toast.success("Lưu lịch phân công thành công");
      onSaved();
    } catch (e) {
      toast.error("Lỗi lưu lập lịch: " + e.message);
    } finally { savingRef.current = false; setSaving(false); }
  };

  const setTask = (id, k, v) => setTasks(ts => ts.map(t => t.id === id ? { ...t, [k]: v } : t));

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">Phân công - {order.order_code}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">&times;</button>
        </div>
        <div className="p-4 overflow-y-auto">
          {loading ? <p className="text-slate-500">Đang tải...</p> : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Công đoạn</th>
                    <th className="px-3 py-2 text-left">Máy</th>
                    <th className="px-3 py-2 text-left">Ngày</th>
                    <th className="px-3 py-2 text-left">Ca</th>
                    <th className="px-3 py-2 text-left">Nhân công</th>
                    <th className="px-3 py-2 text-left">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tasks.length === 0 && <tr><td colSpan="6" className="p-4 text-center text-slate-500">Lệnh chưa được chia công đoạn. Vui lòng vào Chi tiết lệnh để Phân công.</td></tr>}
                  {tasks.map(t => {
                    const dis = t.status === "Hoàn thành" || t.status === "Đã hủy" || t.status === "Đang sản xuất";
                    return (
                      <tr key={t.id}>
                        <td className="px-3 py-2 font-medium text-slate-700">{t.stage}</td>
                        <td className="px-3 py-2">
                          <select disabled={dis} className={inputCls} value={t.machine_id || ""} onChange={e => setTask(t.id, "machine_id", e.target.value)}>
                            <option value="">- Chọn máy -</option>
                            {(lookups.machines || []).filter(m => !t.stage || m.machine_type?.toLowerCase().includes(t.stage.toLowerCase())).map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input disabled={dis} type="date" className={inputCls} value={t.planned_date?.slice(0, 10) || ""} onChange={e => setTask(t.id, "planned_date", e.target.value)} />
                        </td>
                        <td className="px-3 py-2">
                          <input disabled={dis} className={inputCls} placeholder="VD: Ca 1" value={t.shift || ""} onChange={e => setTask(t.id, "shift", e.target.value)} />
                        </td>
                        <td className="px-3 py-2">
                          <input disabled={dis} className={inputCls} placeholder="Nhân công..." value={t.assigned_worker || ""} onChange={e => setTask(t.id, "assigned_worker", e.target.value)} />
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(t.status)}`}>{t.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-lg">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Hủy</button>
          <button onClick={save} disabled={loading || saving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"><Save size={16}/> {saving ? "Đang lưu..." : "Lưu thay đổi"}</button>
        </div>
      </div>
    </div>
  );
}

export default function ProductionModule({ lookups, focusId, onFocusConsumed, onExit }) {
  const { can } = usePerm();
  const [view, setView] = useState("list");
  const [mode, setMode] = useState("table"); // table | gantt
  const [editId, setEditId] = useState(null);
  const [copyId, setCopyId] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const [rows, setRows] = useState([]);
  const [cameFromFocus, setCameFromFocus] = useState(false); // mở từ module khác → back về đúng chỗ

  const load = useCallback(async () => {
    try { setRows(await production.list({})); }
    catch (e) { toast.error("Lỗi tải lệnh sản xuất: " + e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Mở sẵn chi tiết lệnh khi được điều hướng từ module khác (vd: Kế hoạch)
  useEffect(() => {
    if (focusId) { setEditId(focusId); setView("form"); setCameFromFocus(true); onFocusConsumed?.(); }
  }, [focusId]);

  const openForm = ({ edit = null, copy = null } = {}) => { setEditId(edit); setCopyId(copy); setView("form"); };
  const backFromForm = () => {
    setCopyId(null);
    load(); // làm mới danh sách để phản ánh thay đổi vừa lưu ở màn chi tiết
    if (cameFromFocus && onExit) { setCameFromFocus(false); setEditId(null); onExit(); }
    else { setView("list"); setEditId(null); }
  };

  const del = async (id) => {
    if (!confirm("Xóa lệnh sản xuất này?")) return;
    try { await production.remove(id); toast.success("Đã xóa lệnh sản xuất thành công"); load(); } catch (e) { toast.error("Lỗi xóa: " + e.message); }
  };

  if (view === "form")
    return <ProductionForm lookups={lookups} editId={editId} copyId={copyId}
      onBack={backFromForm}
      onSaved={() => { setView("list"); setEditId(null); setCopyId(null); load(); }} />;

  const columns = [
    { key: "order_code", label: "Mã lệnh", filter: "text", render: (r) => <button onClick={() => openForm({ edit: r.id })} className="font-medium text-blue-600 hover:underline">{r.order_code}</button> },
    { key: "product_name", label: "Sản phẩm", filter: "select", tdClass: "text-slate-800" },
    { key: "customer_name", label: "Khách hàng", filter: "select", tdClass: "text-slate-600", render: (r) => r.customer_name || "—" },
    { key: "quantity", label: "SL", align: "right", render: (r) => `${fmt(r.quantity)} ${r.unit || ""}` },
    { key: "status", label: "Trạng thái", filter: "select", options: STATUSES, render: (r) => <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${statusClass(r.status)}`}>{r.status}</span> },
    { key: "attr_color", label: "Màu", filter: "select", render: (r) => r.attr_color || "—" },
    { key: "attr_size", label: "Kích thước", filter: "select", render: (r) => r.attr_size || "—" },
    { key: "machine_name", label: "Máy", filter: "select", render: (r) => r.machine_name_display || r.machine_name || <span className="text-slate-400">Chưa xếp</span> },
    { key: "planned_date", label: "Ngày SX", filter: "date", render: (r) => {
        const d = r.planned_date_display || r.planned_date;
        const s = r.shift_display || r.shift;
        if (!d && !s) return "—";
        return `${d ? fmtDate(d) : ""}${s ? " · " + s : ""}`.replace(/^ · | · $/, '');
      } },
    { key: "due_date", label: "Ngày giao", filter: "date", render: (r) => fmtDate(r.due_date) },
    { key: "_progress", label: "Tiến độ", render: (r) => r.task_count > 0 ? (
        <div className="w-28">
          <div className="flex justify-between text-xs text-slate-500 mb-0.5">
            <span>{fmt(r.produced_qty)}/{fmt(r.quantity)}</span>
            <span>{Math.min(100, Math.round((Number(r.produced_qty) / Number(r.quantity)) * 100))}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${Number(r.produced_qty) >= Number(r.quantity) ? "bg-emerald-500" : "bg-blue-500"}`}
              style={{ width: `${Math.max(Math.min(100, (Number(r.produced_qty) / Number(r.quantity)) * 100), 2)}%` }} />
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">{r.task_done}/{r.task_count} việc xong</div>
        </div>
      ) : <span className="text-slate-400 text-xs">Chưa phân công</span> },
    { key: "priority", label: "Ưu tiên", filter: "select", render: (r) => {
        if (r.priority === 'Cao') return <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-700 whitespace-nowrap">Cao</span>;
        if (r.priority === 'Thấp') return <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 whitespace-nowrap">Thấp</span>;
        return <span className="text-slate-500 text-xs whitespace-nowrap">Trung bình</span>;
      } },
    { key: "_act", label: "", align: "right", render: (r) => (<>
        <button onClick={() => setScheduling(r)} disabled={!can("production", "update")} className="text-slate-400 hover:text-blue-600 p-1" title="Lập lịch / xếp máy"><CalendarClock size={16} /></button>
        {can("production", "create") && <button onClick={() => openForm({ copy: r.id })} title="Sao chép" className="text-slate-400 hover:text-blue-600 p-1"><Copy size={16} /></button>}
        <button onClick={() => del(r.id)} title="Xóa" className="text-slate-400 hover:text-rose-600 p-1"><Trash2 size={16} /></button>
      </>) },
  ];

  return (
    <div className="space-y-5">
      <ListHeader title="Lệnh sản xuất" actions={<>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          <button onClick={() => setMode("table")} className={`flex items-center gap-1.5 px-3 py-1.5 ${mode === "table" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}><List size={15} /> Bảng</button>
          <button onClick={() => setMode("gantt")} className={`flex items-center gap-1.5 px-3 py-1.5 ${mode === "gantt" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}><GanttChartSquare size={15} /> Gantt</button>
        </div>
        {can("production", "create") && <button onClick={() => openForm({})} className="btn-primary"><Plus size={16} /> Tạo lệnh SX</button>}
      </>} />

      {mode === "gantt" && <ProductionGantt onOpenOrder={(id) => openForm({ edit: id })} />}

      {mode === "table" && <DataTable dense columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Chưa có lệnh sản xuất" />}
      {scheduling && <ScheduleModal lookups={lookups} order={scheduling} onClose={() => setScheduling(null)} onSaved={() => { setScheduling(null); load(); }} />}
    </div>
  );
}
