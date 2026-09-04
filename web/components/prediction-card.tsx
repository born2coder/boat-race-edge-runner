import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ReassessmentBadge } from "@/components/reassessment-badge";
import { formatYen, type Prediction } from "@/lib/poc";

export function PredictionCard({ prediction }: { prediction: Prediction }) {
  const replay = prediction.publication_mode === "historical_replay";
  const settlement = prediction.result?.settlement;
  const entries = [...prediction.race.entries].sort((a, b) => a.lane_no - b.lane_no);
  const predictionRanks = new Map(prediction.ranking.map((item) => [item.lane_no, item.rank]));
  const entryByLane = new Map(entries.map((entry) => [entry.lane_no, entry]));
  const resultTopThree = prediction.result?.finishers
    .filter((finisher) => finisher.finish_position !== null && finisher.finish_position <= 3)
    .sort((a, b) => (a.finish_position ?? 99) - (b.finish_position ?? 99)) ?? [];
  return (
    <Card className="prediction-card">
      <CardHeader className="prediction-card-header">
        <div>
          <div className="eyebrow-row">
            <span>{prediction.race.race_date.replaceAll("-", "/")}</span>
            <Badge variant="outline" className={replay ? "badge-purple" : "badge-blue"}>
              {replay ? "過去データで試算" : "公開した予想"}
            </Badge>
            {!replay && prediction.publication_mode === "morning_fixed_hit_v1" && (
              <ReassessmentBadge status={prediction.reassessment?.status} waiting={!prediction.reassessment} />
            )}
          </div>
          <CardTitle className="race-title">
            {prediction.race.venue} <strong>{prediction.race.race_no}R</strong>
          </CardTitle>
          <p className="race-subtitle">{prediction.race.race_name || "一般"}・発走 {prediction.race.start_time_jst} JST</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="prediction-card-body">
          <section className="card-section roster-section" aria-labelledby={`${prediction.prediction_id}-members`}>
            <div className="card-section-title">
              <h3 id={`${prediction.prediction_id}-members`}>出走メンバー</h3>
              <span>全6艇</span>
            </div>
            <div className="member-grid">
              {entries.map((entry) => {
                const predictedRank = predictionRanks.get(entry.lane_no);
                return (
                  <div className="member-row" key={entry.lane_no}>
                    <b className={`lane-dot lane-${entry.lane_no}`}>{entry.lane_no}</b>
                    <div>
                      <strong>{entry.racer_name}</strong>
                      <small>{entry.class}・{entry.branch}・全国勝率 {entry.national_win_rate.toFixed(2)}</small>
                    </div>
                    {predictedRank && <span className="predicted-rank">予想{predictedRank}位</span>}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card-section tickets-section" aria-labelledby={`${prediction.prediction_id}-tickets`}>
            <div className="card-section-title">
              <h3 id={`${prediction.prediction_id}-tickets`}>3連単3点予想</h3>
              <span>各100円</span>
            </div>
            <div className="ticket-lines">
              {prediction.tickets.slice(0, 3).map((ticket, index) => (
                <div key={ticket.combination}>
                  <strong>{ticket.combination}</strong>
                  <span>第{index + 1}予想・100円</span>
                </div>
              ))}
              <div className="ticket-total"><strong>購入額合計</strong><span>{formatYen(prediction.virtual_stake_yen)}</span></div>
            </div>
            <p className="temporary-rule-note">3点を各100円、合計300円で記録しています。</p>
            {prediction.publication_mode === "morning_fixed_hit_v1" && (
              <p className="ticket-lock-note">朝に公開した買い目は、展示後も変更しません。</p>
            )}
          </section>

          <section className="card-section result-section" aria-labelledby={`${prediction.prediction_id}-result`}>
            <div className="card-section-title">
              <h3 id={`${prediction.prediction_id}-result`}>レース結果・収支</h3>
              {settlement && (
                <span className={settlement.hit ? "result-status hit" : "result-status miss"}>
                  {settlement.hit ? "的中" : "不的中"}
                </span>
              )}
            </div>
            {prediction.result && settlement ? (
              <>
                <div className="result-order" aria-label="1着から3着までの結果">
                  {resultTopThree.map((finisher) => {
                    const entry = entryByLane.get(finisher.lane_no);
                    return (
                      <div key={finisher.finish_position}>
                        <span>{finisher.finish_position}着</span>
                        <b className={`lane-dot lane-${finisher.lane_no}`}>{finisher.lane_no}</b>
                        <strong>{entry?.racer_name ?? `登録番号 ${finisher.racer_id}`}</strong>
                      </div>
                    );
                  })}
                </div>
                <div className="result-payout">
                  <div><span>3連単</span><strong>{prediction.result.combination}</strong></div>
                  <div><span>払戻（100円）</span><strong>{formatYen(prediction.result.payout_per_100_yen)}</strong></div>
                </div>
                <div className="settlement-summary">
                  <div><span>購入額</span><strong>{formatYen(settlement.original_stake_yen)}</strong></div>
                  <div><span>払戻額</span><strong>{formatYen(settlement.gross_return_yen)}</strong></div>
                  <div className="settlement-profit">
                    <span>最終収支</span>
                    <strong className={settlement.profit_yen >= 0 ? "positive" : "negative"}>{formatYen(settlement.profit_yen)}</strong>
                  </div>
                </div>
              </>
            ) : (
              <div className="result-pending">レース終了後に、結果と収支をここへ表示します。</div>
            )}
          </section>
        </div>
      </CardContent>
      <CardFooter className="prediction-card-footer">
        <Link href={`/prediction/${prediction.prediction_id}`}>
          このレースの詳細記録を見る <ArrowRight aria-hidden="true" />
        </Link>
      </CardFooter>
    </Card>
  );
}
