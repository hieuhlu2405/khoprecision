/**
 * lib/date-utils.ts
 * Bộ công cụ xử lý ngày giờ chuẩn Việt Nam (GMT+7) cho hệ thống KhoPrecision.
 */

/**
 * Chuyển đổi một chuỗi ISO hoặc đối tượng Date sang múi giờ Việt Nam.
 */
export function toVNTime(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  return date;
}

/**
 * Format ngày theo chuẩn Việt Nam: DD-MM-YYYY
 */
export function formatDateVN(d: string | Date | null | undefined): string {
  const date = toVNTime(d);
  if (!date) return "";
  
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date).replace(/\//g, "-");
}

/**
 * Format ngày giờ theo chuẩn Việt Nam: DD-MM-YYYY HH:mm:ss
 */
export function formatDateTimeVN(d: string | Date | null | undefined): string {
  const date = toVNTime(d);
  if (!date) return "";

  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

/**
 * Láy đối tượng Date hiện tại, nhúng sẵn múi giờ Việt Nam để tính toán.
 */
export function getVNTimeNow(): Date {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(now);
  const find = (type: string) => parts.find(p => p.type === type)?.value;
  
  return new Date(
    Number(find('year')),
    Number(find('month')) - 1,
    Number(find('day')),
    Number(find('hour')),
    Number(find('minute')),
    Number(find('second'))
  );
}

/**
 * Lấy ngày hiện tại ở Việt Nam dưới dạng YYYY-MM-DD
 */
export function getTodayVNStr(): string {
  const date = getVNTimeNow();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
