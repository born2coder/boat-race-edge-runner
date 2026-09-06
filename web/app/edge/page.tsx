import Link from "next/link";
import { ArrowLeft, CircleHelp, Clock3, FlaskConical, ShieldCheck } from "lucide-react";
import { getEdgeDashboard, type EdgeCandidate } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";

export const metadata = { title: "EDGE検証｜オッズと予測の比較", description: "舟の理のHIT予測と締切前オッズを比較し、期待値を検証するページです。", alternates: { canonical: "/edge" } };
export const dynamic = "force-dynamic";
const dateLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short" }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function CandidateCard({ candidate: c, showDate = false }: { candidate: EdgeCandidate; showDate?: boolean }) {
  return <article className={`edge-candidate ${c.status}`}>
    <header><div><strong>{c.venue_name} {c.race_no}R</strong><span>{showDate ? `${dateLabel(c.start_at)} ／ ` : ""}締切 {timeLabel(c.start_at)}</span></div><b>{c.status === "settled" ? (c.hit ? "的中" : "不的中") : c.expected_value_percent >= 300 ? "強いEDGE" : "EDGE候補"}</b></header>
    <div className="edge-combination">{c.combination}</div>
    <dl><div><dt>予測確率</dt><dd>{(c.predicted_probability * 100).toFixed(1)}%</dd></div><div><dt>オッズ</dt><dd>{c.odds_decimal.toFixed(1)}倍</dd></div><div><dt>期待値</dt><dd>{c.expected_value_percent.toFixed(0)}%</dd></div></dl>
    {c.status === "settled" && <p className="edge-settlement">結果 {c.result_combination ?? "—"} ／ 払戻 {c.payout_per_100_yen == null ? "—" : formatYen(c.payout_per_100_yen)}</p>}
    <small>判定 {new Date(c.observed_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</small>
  </article>;
}

export default async function EdgePage() {
  const { today, history, progress } = await getEdgeDashboard();
  const currentHourJst = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }).format(new Date()));
  const monitoringEnded = currentHourJst >= 22;
  const settledHistory = history.filter((candidate) => candidate.status === "settled");
  const historyHits = settledHistory.filter((candidate) => candidate.hit);
  const historyReturn = historyHits.reduce((sum, candidate) => sum + (candidate.payout_per_100_yen ?? 0), 0);
  const historyReturnRate = settledHistory.length ? historyReturn / (settledHistory.length * 100) * 100 : null;

  return <>
    <div className="edge-page-head"><Link href="/" className="back-link"><ArrowLeft aria-hidden="true" /> 今日の予想へ</Link><p className="section-kicker">EDGE VERIFICATION / SHADOW OPERATION</p><h1>オッズと予測を照らし合わせる</h1><p className="edge-lead">朝の通常予想とは別に、HITモデルの予測と締切前オッズの組み合わせを検証するページです。</p></div>
    <section className="edge-explain" aria-labelledby="edge-about-title"><div className="edge-explain-main"><p className="section-kicker">HOW IT WORKS</p><h2 id="edge-about-title">「当たりそうなのに、オッズが高い」買い目を探します</h2><p>締切20分前前後にオッズを一度だけ確認し、予測確率と掛け合わせて期待値を計算します。朝の3点予想を変更したり、通常の成績に混ぜたりはしません。</p></div><div className="edge-rule-list"><div><Clock3 aria-hidden="true" /><strong>締切20分前前後</strong><span>オッズ取得時刻を記録</span></div><div><FlaskConical aria-hidden="true" /><strong>150%以上を検証</strong><span>期待値と実結果を比較</span></div><div><ShieldCheck aria-hidden="true" /><strong>通常予想と分離</strong><span>HIT成績には影響なし</span></div></div></section>

    <section className="edge-progress" aria-label="本日の確認状況"><div><span>本日の対象</span><strong>{progress.scheduled || "—"}<small>R</small></strong></div><div><span>確認・保存済み</span><strong>{progress.observed}<small>R</small></strong></div><div><span>{monitoringEnded ? "未確認" : "これから確認"}</span><strong>{progress.scheduled ? progress.remaining : "—"}<small>R</small></strong></div><p>{monitoringEnded && progress.remaining > 0 ? "本日の監視は終了しました。一部レースを保存できなかったため、未確認数もそのまま公開しています。" : "各レースの締切25〜17分前に順次判定します。"} {progress.lastObservedAt ? `最終確認 ${new Date(progress.lastObservedAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}` : "まだ本日の判定は始まっていません。"}</p></section>

    <section className="edge-results" aria-labelledby="edge-results-title"><div className="section-heading split"><div><p className="section-kicker">TODAY / {dateLabel(new Date().toISOString())}</p><h2 id="edge-results-title">本日のEDGE候補</h2><p>全開催レースを対象に、検証期間中は期待値150%以上の買い目を表示します。</p></div><span className="edge-count">候補 {today.length}件</span></div>{today.length === 0 ? <div className="edge-empty"><CircleHelp aria-hidden="true" /><div><h3>現在、表示できる候補はありません</h3><p>未判定のレースは締切20分前前後に確認します。確認済みでも150%に届かなかった場合は表示されません。</p></div></div> : <div className="edge-candidate-grid">{today.map((candidate) => <CandidateCard candidate={candidate} key={candidate.edge_id} />)}</div>}</section>

    <section className="edge-history" aria-labelledby="edge-history-title"><div className="section-heading split"><div><p className="section-kicker">VERIFICATION LEDGER</p><h2 id="edge-history-title">これまでのEDGE検証履歴</h2><p>150%以上で記録した買い目を、的中・不的中を含めて残します。</p></div><span className="edge-count">記録 {history.length}件</span></div><div className="edge-history-summary"><div><span>結果確定</span><strong>{settledHistory.length}件</strong></div><div><span>的中</span><strong>{historyHits.length}件</strong></div><div><span>検証回収率</span><strong>{historyReturnRate == null ? "—" : `${historyReturnRate.toFixed(1)}%`}</strong></div></div>{history.length === 0 ? <div className="edge-empty"><CircleHelp aria-hidden="true" /><div><h3>過去の候補はまだありません</h3><p>今後150%以上になった候補は、結果とともにここへ蓄積されます。</p></div></div> : <div className="edge-candidate-grid">{history.slice(0, 60).map((candidate) => <CandidateCard candidate={candidate} showDate key={candidate.edge_id} />)}</div>}</section>

    <aside className="edge-disclaimer"><strong>検証中の表示です</strong><p>期待値は利益を保証する数字ではありません。オッズは締切まで変動し、予測確率にも誤差があります。このページの候補は通常予想・成績集計とは別管理です。</p></aside>
  </>;
}
