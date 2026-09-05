import type { Metadata } from "next";
import "./globals.css";
import { SiteShell } from "@/components/site-shell";
import { LiveRefresh } from "@/components/live-refresh";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION, isProductionSite } from "@/lib/site";

// Keep the Japanese official source and Japanese users close to the function.
export const preferredRegion = "hnd1";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "舟の理｜データ分析で導く無料競艇予想", template: "%s｜舟の理" },
  applicationName: SITE_NAME,
  description: SITE_DESCRIPTION,
  robots: { index: isProductionSite, follow: true },
  openGraph: {
    type: "website", locale: "ja_JP", siteName: SITE_NAME,
    title: "舟の理｜データ分析で導く無料競艇予想", description: SITE_DESCRIPTION,
    images: [{ url: "/brand/fune-no-kotowari-logo.png", width: 2172, height: 724, alt: "舟の理" }],
  },
  icons: {
    icon: "/favicon.svg?v=funekoto1",
    shortcut: "/favicon.svg?v=funekoto1",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased"><SiteShell><LiveRefresh />{children}</SiteShell></body>
    </html>
  );
}
