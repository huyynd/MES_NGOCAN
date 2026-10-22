// Cài đặt hệ thống dùng chung cho mọi màn (nguồn: /lookups → settings, backend core/lib/settings.js).
// MẶC ĐỊNH = giá trị trước đây gắn cứng → trong lúc chưa tải xong (hoặc tải lỗi) app vẫn chạy như cũ.
// Riêng ngưỡng công nợ KHÔNG dùng mặc định ở đây — các màn công nợ lấy từ API công nợ (S-12: chưa có thì hiện "—").
import { useSyncExternalStore } from "react";

export const SETTING_DEFAULTS = {
  vat_percent: 8,
  urgent_days: 5,
  priority_top: 5,
  scrap_alert_percent: 5,
  schedule_lock_days: 3,
  near_min_percent: 120,
  company_name: "CÔNG TY TNHH THƯƠNG MẠI SẢN XUẤT XNK BAO BÌ NGỌC AN THƯ",
  company_tax: "0316748578",
  company_address: "119/1 Đường Đỗ Mười, Tổ 4, Khu phố 1, Phường Thới An, Thành Phố Hồ Chí Minh",
  company_phone: "0938 446 156",
};

let current = SETTING_DEFAULTS;
const subs = new Set();

/** Gọi khi tải lookups xong (MesApp) hoặc sau khi lưu ở màn Cài đặt */
export function setAppSettings(s) {
  if (!s) return;
  current = { ...SETTING_DEFAULTS, ...s };
  subs.forEach((fn) => fn());
}

/** Hook: const s = useAppSettings(); s.vat_percent … (tự vẽ lại khi cài đặt đổi) */
export function useAppSettings() {
  return useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => current);
}

export const getAppSettings = () => current;
