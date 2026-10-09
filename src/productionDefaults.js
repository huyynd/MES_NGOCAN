// src/productionDefaults.js — giá trị GỢI Ý điền sẵn khi lên lệnh sản xuất (đồng bộ backend planningController.DEFAULT_STAGES)
// Chỉ để đỡ nhập liệu: người dùng vẫn thêm / xóa / sửa bình thường, không có gì bị khóa cứng.

// Công đoạn mặc định: LUÔN Thổi + Cắt (chủ dự án chốt 2026-10-09). Không chia theo loại SP vì 1 SP
// có thể vừa là TP vừa là BTP; không dùng Quy trình công nghệ. Thừa công đoạn nào người dùng tự xóa.
export const DEFAULT_STAGES = ["Thổi", "Cắt"];

// Nhà máy mặc định của công đoạn
export const stageFactory = (stage) => (stage === "Cắt" ? "Nhà máy cắt" : "Nhà máy thổi");
