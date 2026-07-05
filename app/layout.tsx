import type { Metadata, Viewport } from "next";
import { BrowserChrome } from "@/app/components/BrowserChrome";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Precision Packaging | Dashboard",
    template: "Precision Packaging | %s",
  },
  description: "Hệ thống quản lý kho nội bộ — Công ty Cổ phần Precision Packaging.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <BrowserChrome />
        {children}
      </body>
    </html>
  );
}

