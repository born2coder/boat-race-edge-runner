import Link from "next/link";
import Image from "next/image";
import { BarChart3, CalendarDays, CircleHelp, History, Eye } from "lucide-react";

const navigation = [
  { href: "/today", label: "TODAY", icon: CalendarDays },
  { href: "/watch", label: "WATCH", icon: Eye },
  { href: "/signal-log", label: "SIGNAL LOG", icon: History },
  { href: "/performance", label: "PERFORMANCE", icon: BarChart3 },
  { href: "/settings", label: "SETTINGS", icon: CircleHelp },
];

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="shell-width header-inner">
          <Link href="/today" className="brand" aria-label="舟の理（ふねのことわり）ホーム">
            <Image src="/brand/fune-no-kotowari-transparent.png" alt="BOAT RACE EDGE — Research Terminal" width={2172} height={724} sizes="(max-width: 640px) 208px, 280px" className="brand-logo" priority />
          </Link>
          <nav className="desktop-nav" aria-label="メインナビゲーション">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href}>{item.label}</Link>
            ))}
          </nav>
          <span className="age-chip">20歳未満の舟券購入禁止</span>
        </div>
      </header>
      <main className="shell-width main-content">{children}</main>
      <footer className="site-footer">
        <div className="shell-width footer-grid">
          <div>
            <strong>BOAT RACE EDGE · Research Terminal</strong>
            <p>締切前の観測、状態遷移、確定結果を記録し、Shadow Forwardで検証します。</p>
          </div>
          <p>
            本サイトは非公式です。BOAT RACE振興会、日本モーターボート競走会、各施行者・ボートレース場とは関係ありません。
            利益を保証しません。舟券の購入は20歳以上が対象です。
          </p>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
