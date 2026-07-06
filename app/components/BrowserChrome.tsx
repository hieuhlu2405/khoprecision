"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const APP_NAME = "Precision Packaging";

const EXACT_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/app": "Dashboard",
  "/login": "Đăng nhập",
  "/me": "Tài khoản của tôi",
  "/profile": "Hồ sơ",
  "/products": "Mã hàng",
  "/customers": "Khách hàng",
  "/selling-entities": "Pháp nhân",
  "/vehicles": "Danh sách xe",
  "/vehicles/report": "Logistics",
  "/inventory/report": "Tồn kho hiện tại",
  "/inventory/opening": "Tồn đầu kỳ",
  "/inventory/inbound": "Nhập kho",
  "/inventory/outbound": "Xuất kho",
  "/inventory/phoi": "Nhập phôi",
  "/inventory/stocktake": "Kiểm kê",
  "/inventory/value-report": "Giá trị tồn kho",
  "/inventory/aging": "Tồn dài kỳ",
  "/inventory/comparison": "Đối chiếu tồn kho",
  "/inventory/report-history": "Lịch sử chốt kho",
  "/delivery-plan": "Kế hoạch giao hàng",
  "/delivery-plan/shortage": "Cảnh báo thiếu hàng",
  "/delivery-plan/log": "Nhật ký giao hàng",
  "/sales-command-center": "Sales Command Center",
  "/accounting": "Công nợ kế toán",
  "/admin/users": "Người dùng",
};

const PREFIX_TITLES: Array<[string, string]> = [
  ["/inventory/stocktake/", "Chi tiết kiểm kê"],
  ["/inventory/report-history/", "Chi tiết bản chốt"],
];

function resolvePageTitle(pathname: string): string {
  const path = pathname.replace(/\/$/, "") || "/";
  if (EXACT_TITLES[path]) return EXACT_TITLES[path];

  const prefixMatch = PREFIX_TITLES.find(([prefix]) => path.startsWith(prefix));
  if (prefixMatch) return prefixMatch[1];

  return "Dashboard";
}

export function BrowserChrome() {
  const pathname = usePathname();

  useEffect(() => {
    document.title = `${APP_NAME} | ${resolvePageTitle(pathname)}`;
  }, [pathname]);

  return null;
}
