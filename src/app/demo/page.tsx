import type { Metadata } from "next";
import { SooiApp } from "@/components/sooi/sooi-app";

export const metadata: Metadata = {
  title: "Dùng thử Sổ Ơi — Không cần đăng ký",
  description: "Trải nghiệm Sổ Ơi ngay, không cần tài khoản. Dữ liệu lưu trên trình duyệt của bạn.",
};

export default function DemoPage() {
  return <SooiApp userId={null} userEmail="Khách dùng thử" />;
}
