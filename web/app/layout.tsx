import type { Metadata } from "next";
import "./globals.css";
import { SiteShell } from "@/components/site-shell";

export const metadata: Metadata = {
  title: "BOAT RACE EDGE｜本日の厳選3連単予想",
  description: "全レースから狙い目を選び、1日最大10レースの3連単3点予想を無料公開します。",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased"><SiteShell>{children}</SiteShell></body>
    </html>
  );
}
