import Link from "next/link";

export default function NotFound() {
  return <section className="not-found"><span>404</span><h1>記録が見つかりません</h1><p>予想IDが存在しないか、URLが正しくありません。</p><Link href="/history">全予想履歴へ戻る</Link></section>;
}
