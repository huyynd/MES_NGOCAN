// src/productionDefaults.js — giá trị GỢI Ý điền sẵn khi lên lệnh sản xuất (đồng bộ backend planningController.DEFAULT_STAGES)
// Chỉ để đỡ nhập liệu: người dùng vẫn thêm / xóa / sửa bình thường, không có gì bị khóa cứng.

// Công đoạn mặc định: LUÔN Thổi + Cắt (chủ dự án chốt 2026-10-09). Không chia theo loại SP vì 1 SP
// có thể vừa là TP vừa là BTP; không dùng Quy trình công nghệ. Thừa công đoạn nào người dùng tự xóa.
export const DEFAULT_STAGES = ["Thổi", "Cắt"];

// Nhà máy mặc định của công đoạn
export const stageFactory = (stage) => (stage === "Cắt" ? "Nhà máy cắt" : "Nhà máy thổi");

// P-10: máy dùng được cho 1 công đoạn — nhà máy hoặc loại máy CHỨA tên công đoạn (vd "Thổi" ↔ "Nhà máy thổi").
// Không gắn cứng tên nhà máy; không có máy nào khớp thì trả hết để người dùng tự chọn.
export const machinesForStage = (machines, stage) => {
  const list = machines || [];
  const s = (stage || "").trim().toLowerCase();
  if (!s) return list;
  const hit = list.filter((m) => `${m.factory || ""} ${m.machine_type || ""}`.toLowerCase().includes(s));
  return hit.length ? hit : list;
};
