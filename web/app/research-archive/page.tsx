import Link from "next/link";
export default function Archive() {
  return (
    <section className="fp-page">
      <h1>旧研究画面・既存履歴</h1>
      <p>
        旧戦略の画面とデータを保持しています。新しい120％基準の仮想成績とは別の記録です。
      </p>
      <ul>
        {[
          ["/research-archive/performance", "旧運用成績"],
          ["/research-archive/signal-log", "旧判断履歴"],
          ["/legacy", "旧予想画面"],
          ["/edge/legacy", "旧EDGE履歴"],
          ["/history", "既存の的中・結果履歴"],
          ["/settings", "判定設定・旧ルール履歴"],
        ].map(([href, label]) => (
          <li key={href}>
            <Link href={href} prefetch={false}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
