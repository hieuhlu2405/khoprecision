const ACTION_PREFIX = "Cách xử lý:";

const VIETNAMESE_HINTS = /[À-ỹ]|không|lỗi|thiếu|chưa|vui lòng|bị chặn|không thể|không được|chỉ admin|mã hàng|tồn kho/i;
const TECHNICAL_HINTS = /(?:postgres|supabase|fetch failed|networkerror|failed to fetch|row-level security|violates|constraint|duplicate key|jwt|uuid|rpc|sqlstate|pgrst|schema cache|permission denied)/i;

function vietnameseMessage(raw: string): string {
  const message = raw.trim().replace(/\r\n/g, "\n");
  const lower = message.toLowerCase();

  if (!message) return "Không thực hiện được thao tác.";
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return "Không kết nối được máy chủ.";
  }
  if (/jwt|session|not authenticated|đăng nhập|dang nhap/i.test(message)) {
    return "Phiên đăng nhập đã hết hoặc không hợp lệ.";
  }
  if (/permission denied|row-level security|not authorized|không có quyền|khong co quyen|chi admin|chỉ admin/i.test(message)) {
    return "Tài khoản không có quyền thực hiện thao tác này.";
  }
  if (/duplicate key|already exists|đã tồn tại|trùng|bi nhap trung/i.test(message)) {
    return "Dữ liệu bị trùng với thông tin đã có.";
  }
  if (/not found|không tìm thấy|khong tim thay/i.test(message)) {
    return "Không tìm thấy dữ liệu cần xử lý.";
  }
  if (/locked|đã khóa|da khoa|kỳ đã khóa/i.test(message)) {
    return "Dữ liệu đã khóa nên không thể thay đổi.";
  }
  if (/insufficient|negative stock|không đủ tồn|khong du ton|âm kho/i.test(message)) {
    return message
      .replace(/;\s*(?=(?:mã|ma|sku)\b)/gi, "\n")
      .replace(/,\s*(?=(?:mã|ma|sku)\b)/gi, "\n");
  }

  if (TECHNICAL_HINTS.test(message) || (!VIETNAMESE_HINTS.test(message) && /^[\x00-\x7F]+$/.test(message))) {
    return "Không thực hiện được thao tác.";
  }

  return lower === "lỗi" || lower === "có lỗi xảy ra"
    ? "Không thực hiện được thao tác."
    : message;
}

function guidanceFor(message: string): string {
  if (/kết nối|máy chủ/i.test(message)) return "Kiểm tra mạng rồi thử lại.";
  if (/đăng nhập|phiên/i.test(message)) return "Đăng nhập lại rồi thử lại.";
  if (/không có quyền|tài khoản/i.test(message)) return "Liên hệ Admin để được cấp quyền.";
  if (/trùng/i.test(message)) return "Kiểm tra và bỏ dòng trùng rồi thử lại.";
  if (/khóa/i.test(message)) return "Chọn kỳ chưa khóa hoặc liên hệ Admin.";
  if (/tồn kho|âm kho|không đủ tồn/i.test(message)) return "Giảm số lượng xuất hoặc nhập thêm hàng rồi thử lại.";
  if (/không tìm thấy/i.test(message)) return "Tải lại trang, chọn lại dữ liệu rồi thử lại.";
  if (/thiếu|chưa chọn|vui lòng nhập/i.test(message)) return "Bổ sung thông tin còn thiếu rồi thử lại.";
  return "Kiểm tra dữ liệu vừa nhập rồi thử lại. Nếu vẫn lỗi, báo Admin.";
}

export function formatUserError(input: unknown, fallback = "Không thực hiện được thao tác."): string {
  const raw = typeof input === "string"
    ? input
    : input instanceof Error
      ? input.message
      : (input && typeof input === "object" && "message" in input && typeof input.message === "string")
        ? input.message
        : fallback;
  const message = vietnameseMessage(raw || fallback);
  if (message.includes(ACTION_PREFIX)) return message;
  return `${message}\n${ACTION_PREFIX} ${guidanceFor(message)}`;
}
