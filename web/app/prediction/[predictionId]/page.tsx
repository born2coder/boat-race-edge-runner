import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getDisplayPrediction } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";

export const dynamic = "force-dynamic";

export default async function PredictionDetailPage({ params }: { params: Promise<{ predictionId: string }> }) {
  const { predictionId } = await params;
  const prediction = await getDisplayPrediction(predictionId);
  if (!prediction) notFound();
  const result = prediction.result;
  const settlement = result?.settlement;
  const isReplay = prediction.publication_mode === "historical_replay";

  return (
    <article className="page-section detail-page">
      <Link href="/history" className="back-link"><ArrowLeft aria-hidden="true" /> 過去の予想へ</Link>

      <header className="detail-header">
        <div>
          <div className="eyebrow-row">
            <span>{prediction.race.race_date.replaceAll("-", "/")}</span>
            <Badge variant="outline" className="badge-purple">{isReplay ? "過去データの参考予想" : "公開予想"}</Badge>
            <Badge variant="outline" className={result ? "badge-green" : "badge-amber"}>{result ? "結果確定" : "結果待ち"}</Badge>
          </div>
          <h1>{prediction.race.venue} <strong>{prediction.race.race_no}R</strong></h1>
          <p>{prediction.race.race_name || "一般"}・発走予定 {prediction.race.start_time_jst} JST</p>
        </div>
      </header>

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
          <aside className="bet-explanation"><strong>買い目について</strong><p>3点を各100円、合計300円で記録しています。</p></aside>
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
