import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReassessmentBadge } from "@/components/reassessment-badge";
import { getDisplayPrediction } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";
import { racePhase, officialResultUrl } from "@/lib/race-lifecycle";

export const dynamic = "force-dynamic";

export default async function PredictionDetailPage({ params }: { params: Promise<{ predictionId: string }> }) {
  const { predictionId } = await params;
  const prediction = await getDisplayPrediction(predictionId);
  if (!prediction) notFound();
  const result = prediction.result;
  const settlement = result?.settlement;
  const isReplay = prediction.publication_mode === "historical_replay";
  const phase = racePhase(prediction);
  const source = officialResultUrl(prediction.race_id);

  return (
    <article className="page-section detail-page">
      <Link href="/history" className="back-link"><ArrowLeft aria-hidden="true" /> 過去の予想へ</Link>

      <header className="detail-header">
        <div>
          <div className="eyebrow-row">
            <span>{prediction.race.race_date.replaceAll("-", "/")}</span>
            <Badge variant="outline" className="badge-purple">{isReplay ? "過去データの参考予想" : prediction.official_performance_eligible ? "公開予想" : "成績対象外の記録"}</Badge>
            {!isReplay && prediction.official_performance_eligible && prediction.publication_mode === "morning_fixed_hit_v1" && (
              <ReassessmentBadge status={prediction.reassessment?.status} waiting={!prediction.reassessment} cutoffReached={phase !== "upcoming" || Date.parse(prediction.race.start_at) - Date.now() <= 300_000} />
            )}
            <Badge variant="outline" className={settlement?.hit ? "badge-green" : "badge-amber"}>{settlement ? settlement.hit ? "的中" : "不的中" : phase === "pending" ? "締切済み・結果確認中" : "締切前"}</Badge>
          </div>
          <h1>{prediction.race.venue} <strong>{prediction.race.race_no}R</strong></h1>
          <p>{prediction.race.race_name || "一般"}・締切予定 {prediction.race.start_time_jst} JST</p>
        </div>
      </header>

      {!isReplay && !prediction.official_performance_eligible && <p role="note">公開が締切に間に合わなかったため、おすすめ・的中率・回収率の対象外です。買い目は変更せず記録として残しています。</p>}

      {phase !== "upcoming" && <section className="detail-card">
        <h2>{settlement ? `事前予想は${settlement.hit ? "的中" : "不的中"}でした` : "締切済み・結果確認中"}</h2>
        <p>公開した3点：{prediction.tickets.slice(0, 3).map((t) => t.combination).join(" ／ ")}</p>
        {result ? <><p>実際の結果：<strong>{result.combination}</strong></p><p>{[...result.finishers].filter((f) => f.finish_position !== null && f.finish_position <= 3).sort((a, b) => a.finish_position! - b.finish_position!).map((f) => `${f.finish_position}着 ${f.lane_no}号艇 ${prediction.race.entries.find((e) => e.lane_no === f.lane_no)?.racer_name ?? f.racer_id}`).join(" ／ ")}</p><p>仮想購入 {formatYen(settlement!.original_stake_yen)} → 払戻 {formatYen(settlement!.gross_return_yen)}</p></> : <p>確認でき次第、的中・不的中を表示します。結果未取得や返還などの確認中は、成績に含めません。</p>}
        {source && <a href={source} target="_blank" rel="noopener noreferrer">公式結果を確認 ↗</a>}
      </section>}

      <section className="detail-card boat-section">
        <div className="section-heading"><div><p className="section-kicker">START LIST</p><h2>出走6艇</h2></div></div>
        <div className="boat-grid">
          {prediction.race.entries.map((entry) => (
            <article key={entry.lane_no} className={`boat-card lane-border-${entry.lane_no}`}>
              <header><b className={`lane-dot lane-${entry.lane_no}`}>{entry.lane_no}</b><div><strong>{entry.racer_name}</strong><span>登録 {entry.racer_id}・{entry.class}・{entry.branch}</span></div></header>
              <dl>
                <div><dt>全国勝率</dt><dd>{entry.national_win_rate.toFixed(2)}</dd></div>
                <div><dt>当地勝率</dt><dd>{entry.local_win_rate.toFixed(2)}</dd></div>
                <div><dt>モーター</dt><dd>{entry.motor_no}号 / {entry.motor_2rate.toFixed(2)}%</dd></div>
                <div><dt>ボート</dt><dd>{entry.equipment_boat_no}号 / {entry.boat_2rate.toFixed(2)}%</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <div className="detail-grid forecast-grid">
        <section className="detail-card forecast-card">
          <p className="section-kicker">PICK ORDER</p>
          <h2>注目艇</h2>
          <div className="detail-ranking">{prediction.ranking.map((item) => <div key={item.rank}><span>{item.rank}位</span><b className={`lane-dot lane-${item.lane_no}`}>{item.lane_no}</b><strong>{item.racer_name}</strong></div>)}</div>
        </section>
        <section className="detail-card bet-card">
          <p className="section-kicker">TRIFECTA PICKS</p>
          <h2>3連単3点予想</h2>
          <div className="ticket-list">{prediction.tickets.slice(0, 3).map((ticket, index) => <div key={ticket.combination}><span>第{index + 1}予想　{ticket.combination}</span><strong>100円</strong></div>)}<div className="ticket-total"><span>合計</span><strong>{formatYen(prediction.virtual_stake_yen)}</strong></div></div>
          <aside className="bet-explanation"><strong>買い目について</strong><p>3点を各100円、合計300円で記録しています。朝に公開した買い目は、展示後も変更しません。</p></aside>
        </section>
      </div>

      {result && settlement && (
        <section className="detail-card settlement-card">
          <div className="section-heading"><div><p className="section-kicker">RESULT</p><h2>結果・仮想収支</h2></div><Badge className={settlement.hit ? "result-hit" : "result-miss"}>{settlement.hit ? "的中" : "不的中"}</Badge></div>
          <div className="result-hero"><div><span>3連単結果</span><strong>{result.combination}</strong></div><div><span>100円あたり払戻</span><strong>{formatYen(result.payout_per_100_yen)}</strong></div><div><span>仮想収支</span><strong className={settlement.profit_yen >= 0 ? "positive" : "negative"}>{formatYen(settlement.profit_yen)}</strong></div></div>
          <div className="settlement-lines">{settlement.lines.map((line) => <div key={line.combination}><span>{line.combination}</span><span>{formatYen(line.stake_yen)} × {line.return_yen > 0 ? `${result.payout_per_100_yen / 100}` : "0"}</span><strong>{formatYen(line.return_yen)}</strong></div>)}<div className="settlement-total"><span>合計</span><span>仮想購入 {formatYen(settlement.original_stake_yen)}</span><strong>仮想払戻 {formatYen(settlement.gross_return_yen)}</strong></div></div>
          <p className="score-note">{isReplay ? "過去データによる参考予想です。実際に公開した予想の成績とは分けて集計します。" : "公開した3点予想の結果です。公開後の買い目は変更しません。"}</p>
        </section>
      )}
    </article>
  );
}
