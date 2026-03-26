import { redirect } from "next/navigation";

// Trang /test đã được ẩn — redirect về trang chính
export default function TestPage() {
  redirect("/app");
}
