import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-be-vietnam-pro",
});

export const metadata: Metadata = {
  title: { default: "Sổ Ơi — Bán hàng dễ hơn", template: "%s | Sổ Ơi" },
  description: "Sổ bán hàng local-first, nhanh, rõ và dùng được trên mọi thiết bị.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={beVietnamPro.variable}>
      <body>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
