import Link from "next/link";
import Image from "next/image";
import { BarChart3, CalendarDays, CircleHelp, History } from "lucide-react";

const navigation = [
  { href: "/", label: "今日の予想", icon: CalendarDays },
  { href: "/history", label: "過去の予想", icon: History },
  { href: "/stats", label: "成績", icon: BarChart3 },
  { href: "/about", label: "このサイトについて", icon: CircleHelp },
];

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="shell-width header-inner">
          <Link href="/" className="brand" aria-label="舟の理（ふねのことわり）ホーム">
            <Image src="/brand/fune-no-kotowari-logo.png" alt="舟の理 — 競艇の理をデータで紐解き、予想を導く。" width={2172} height={724} sizes="(max-width: 640px) 260px, 350px" className="brand-logo" priority />
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
            <strong>舟の理 — 競艇の理をデータで紐解き、予想を導く。</strong>
            <p>出した買い目は後から変えず、的中・不的中をすべて残します。</p>
          </div>
          <p>
            本サイトは非公式です。BOAT RACE振興会、日本モーターボート競走会、各施行者・ボートレース場とは関係ありません。
            予想結果や利益を保証しません。舟券の購入は20歳以上が対象です。無理のない範囲でお楽しみください。
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
