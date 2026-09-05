import Link from "next/link";
import { ArrowLeft, CircleHelp, Clock3, FlaskConical, ShieldCheck } from "lucide-react";
import { getEdgeCandidates } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";

export const metadata = { title: "EDGE検証｜オッズと予測の比較", description: "舟の理のHIT予測と締切前オッズを比較し、期待値を検証するページです。", alternates: { canonical: "/edge" } };
export const dynamic = "force-dynamic";
const dateLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short" }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export default async function EdgePage() {
  const candidates = await getEdgeCandidates();
  const open = candidates.filter((c) => c.status === "open");
  return <>
    <div className="edge-page-head"><Link href="/" className="back-link"><ArrowLeft aria-hidden="true" /> 今日の予想へ</Link><p className="section-kicker">EDGE VERIFICATION / SHADOW OPERATION</p><h1>オッズと予測を照らし合わせる</h1><p className="edge-lead">朝の通常予想とは別に、HITモデルの予測と締切前オッズの組み合わせを検証するページです。</p></div>
    <section className="edge-explain" aria-labelledby="edge-about-title"><div className="edge-explain-main"><p className="section-kicker">HOW IT WORKS</p><h2 id="edge-about-title">「当たりそうなのに、オッズが高い」買い目を探します</h2><p>締切20分前前後にオッズを一度だけ確認し、予測確率と掛け合わせて期待値を計算します。朝の3点予想を変更したり、通常の成績に混ぜたりはしません。</p></div><div className="edge-rule-list"><div><Clock3 aria-hidden="true" /><strong>締切20分前前後</strong><span>オッズ取得時刻を記録</span></div><div><FlaskConical aria-hidden="true" /><strong>検証中</strong><span>期待値と実結果を比較</span></div><div><ShieldCheck aria-hidden="true" /><strong>通常予想と分離</strong><span>HIT成績には影響なし</span></div></div></section>
    <section className="edge-results" aria-labelledby="edge-results-title"><div className="section-heading split"><div><p className="section-kicker">TODAY / {dateLabel(new Date().toISOString())}</p><h2 id="edge-results-title">本日のEDGE候補</h2><p>現在は検証運用です。条件を満たした買い目だけを記録します。</p></div><span className="edge-count">候補 {open.length}件</span></div>{candidates.length === 0 ? <div className="edge-empty"><CircleHelp aria-hidden="true" /><div><h3>本日の検証データはまだありません</h3><p>締切前オッズの取得と計算が完了すると、ここに候補が表示されます。通常の朝予想とは別に集計しています。</p></div></div> : <div className="edge-candidate-grid">{candidates.map((c) => <article className={`edge-candidate ${c.status}`} key={c.edge_id}><header><div><strong>{c.venue_name} {c.race_no}R</strong><span>締切 {timeLabel(c.start_at)}</span></div><b>{c.status === "settled" ? (c.hit ? "的中" : "不的中") : "検証候補"}</b></header><div className="edge-combination">{c.combination}</div><dl><div><dt>予測確率</dt><dd>{(c.predicted_probability * 100).toFixed(1)}%</dd></div><div><dt>オッズ</dt><dd>{c.odds_decimal.toFixed(1)}倍</dd></div><div><dt>期待値</dt><dd>{c.expected_value_percent.toFixed(0)}%</dd></div></dl>{c.status === "settled" && <p className="edge-settlement">結果 {c.result_combination ?? "—"} ／ 払戻 {c.payout_per_100_yen == null ? "—" : formatYen(c.payout_per_100_yen)}</p>}<small>取得 {new Date(c.observed_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</small></article>)}</div>}</section>
    <aside className="edge-disclaimer"><strong>検証中の表示です</strong><p>期待値は利益を保証する数字ではありません。オッズは締切まで変動し、予測確率にも誤差があります。このページの候補は通常予想・成績集計とは別管理です。</p></aside>
  </>;
}
