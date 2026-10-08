import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  History,
  SlidersHorizontal,
  Ship,
} from "lucide-react";
const navigation = [
  { href: "/today", label: "今後の買い目", icon: CalendarDays },
  { href: "/signal-log", label: "判断履歴", icon: History },
  { href: "/performance", label: "運用成績", icon: BarChart3 },
  { href: "/settings", label: "判定設定", icon: SlidersHorizontal },
];
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell fp-shell">
      <header className="site-header">
        <div className="shell-width header-inner">
          <Link
            href="/today"
            prefetch={false}
            className="brand fp-brand"
            aria-label="BOAT RACE EDGE ホーム"
          >
            <Ship aria-hidden="true" />
            <span>
              BOAT RACE <em>EDGE</em>
              <small>ボートレース研究端末</small>
            </span>
          </Link>
          <nav className="desktop-nav" aria-label="メインナビゲーション">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} prefetch={false}>
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="age-chip">20歳未満の舟券購入禁止</span>
        </div>
      </header>
      <main className="shell-width main-content">{children}</main>
      <footer className="site-footer">
        <div className="shell-width footer-grid">
          <div>
            <strong>BOAT RACE EDGE</strong>
            <p>保存された観測・判断・確定結果を検証する研究用端末です。</p>
            <Link href="/research-archive" prefetch={false}>
              旧画面・既存履歴
            </Link>
          </div>
          <p>
            本サイトは非公式です。BOAT
            RACE振興会、日本モーターボート競走会、各施行者・ボートレース場とは関係ありません。利益を保証しません。舟券の購入は20歳以上が対象です。
          </p>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} prefetch={false}>
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
