import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (OFL, see app/fonts/Vazirmatn-OFL.txt): no Google Fonts CDN,
// which may be blocked or slow from inside Iran.
const vazirmatn = localFont({
  src: "./fonts/Vazirmatn-Variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-vazirmatn",
});

export const metadata: Metadata = {
  title: "سفارش میز",
  description: "مدیریت سفارش میز برای کافه و رستوران",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
