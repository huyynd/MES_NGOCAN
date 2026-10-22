// src/productionDefaults.js — giá trị GỢI Ý điền sẵn khi lên lệnh sản xuất (đồng bộ backend planningController.DEFAULT_STAGES)
// Chỉ để đỡ nhập liệu: người dùng vẫn thêm / xóa / sửa bình thường, không có gì bị khóa cứng.

// Công đoạn mặc định: LUÔN Thổi + Cắt (chủ dự án chốt 2026-10-09). Không chia theo loại SP vì 1 SP
// có thể vừa là TP vừa là BTP; không dùng Quy trình công nghệ. Thừa công đoạn nào người dùng tự xóa.
export const DEFAULT_STAGES = ["Thổi", "Cắt"];

// Danh sách nhà máy DÙNG CHUNG cho Máy / Kho / Nhân viên / phân quyền (phạm vi dữ liệu so theo tên này — đừng viết riêng)
export const FACTORIES = ["Nhà máy thổi", "Nhà máy cắt"];
export const EMPLOYEE_UNITS = [...FACTORIES, "Quản lý"]; // "Quản lý" chỉ dùng cho Nhân viên

// Nhà máy mặc định của công đoạn
export const stageFactory = (stage) => (stage === "Cắt" ? FACTORIES[1] : FACTORIES[0]);

// P-10: máy dùng được cho 1 công đoạn — nhà máy hoặc loại máy CHỨA tên công đoạn (vd "Thổi" ↔ "Nhà máy thổi").
// Không gắn cứng tên nhà máy; không có máy nào khớp thì trả hết để người dùng tự chọn.
export const machinesForStage = (machines, stage) => {
  const list = machines || [];
  const s = (stage || "").trim().toLowerCase();
  if (!s) return list;
  const hit = list.filter((m) => `${m.factory || ""} ${m.machine_type || ""}`.toLowerCase().includes(s));
  return hit.length ? hit : list;
};
