import Link from "next/link";
import { ReassessmentBadge } from "@/components/reassessment-badge";
import { racePhase, officialResultUrl } from "@/lib/race-lifecycle";
import { formatYen, type Prediction } from "@/lib/poc";

export function TodayRaces({ predictions, now }: { predictions: Prediction[]; now: number }) {
  const sorted = [...predictions].sort((a, b) => Date.parse(a.race.start_at) - Date.parse(b.race.start_at));
  const upcoming = sorted.filter((p) => racePhase(p, now) === "upcoming");
  const closed = sorted.filter((p) => racePhase(p, now) !== "upcoming").reverse();
  return <>
    <div className="race-section-tabs"><a href="#upcoming-races">これから {upcoming.length}R</a><a href="#today-results">結果・締切済み {closed.length}R</a></div>
    <h3 id="upcoming-races" className="race-list-heading">これからの予想 <small>締切時刻順</small></h3>
    {upcoming.length === 0 ? <div className="result-pending">本日の公開予想はすべて締切済みです。結果は下の一覧で確認できます。</div> : <div className="daily-race-grid">{upcoming.map((p) => <article className="daily-race-card" key={p.prediction_id}>
      <header><h4>{p.race.venue} {p.race.race_no}R</h4><strong>締切 {p.race.start_time_jst}</strong></header>
      <p>{p.race.race_name}</p>
      <ReassessmentBadge status={p.reassessment?.status} waiting={!p.reassessment} cutoffReached={Date.parse(p.race.start_at) - now <= 300_000} />
      <div className="daily-tickets" aria-label="朝に公開した3点">{p.tickets.slice(0, 3).map((t) => <b key={t.combination}>{t.combination}</b>)}</div>
      <Link href={`/prediction/${p.prediction_id}`} prefetch={false} className="text-link">選手・予想の詳細を見る →</Link>
    </article>)}</div>}
    <h3 id="today-results" className="race-list-heading">今日の予想と結果 <small>締切済み {closed.length}R</small></h3>
    <p>朝に公開した3点は変更していません。各100円・計300円で買った場合の結果です。</p>
    {closed.length === 0 ? <div className="result-pending">まだ締切を迎えた公開予想はありません。</div> : <div className="daily-race-grid">{closed.map((p) => {
      const result = p.result;
      const settlement = result?.settlement;
      const source = officialResultUrl(p.race_id);
      return <article className="daily-race-card" key={p.prediction_id}>
        <header><h4>{p.race.venue} {p.race.race_no}R</h4><span className={settlement ? settlement.hit ? "result-status hit" : "result-status miss" : "result-status"}>{settlement ? settlement.hit ? "的中" : "不的中" : "結果確認中"}</span></header>
        <p>締切 {p.race.start_time_jst}・{result ? "結果確定" : "締切済み"}</p>
        <span className="daily-caption">事前に公開した3点</span>
        <div className="daily-tickets">{p.tickets.slice(0, 3).map((t) => <b className={result?.combination === t.combination ? "winning-ticket" : undefined} key={t.combination}>{t.combination}{result?.combination === t.combination ? " ✓" : ""}</b>)}</div>
        {result && settlement ? <>
          <div className="daily-result"><span>実際の結果</span><strong>{result.combination}</strong></div>
          <ol className="daily-finishers">{[...result.finishers].filter((f) => f.finish_position !== null && f.finish_position <= 3).sort((a, b) => a.finish_position! - b.finish_position!).map((f) => <li key={f.lane_no}><span>{f.finish_position}着</span><b className={`lane-dot lane-${f.lane_no}`}>{f.lane_no}</b><strong>{p.race.entries.find((e) => e.lane_no === f.lane_no)?.racer_name ?? f.racer_id}</strong></li>)}</ol>
          <div className="daily-return">仮想購入 {formatYen(settlement.original_stake_yen)} → 払戻 <strong>{formatYen(settlement.gross_return_yen)}</strong><br />収支 <strong className={settlement.profit_yen >= 0 ? "positive" : "negative"}>{formatYen(settlement.profit_yen)}</strong></div>
        </> : <p className="pending-note">結果を確認でき次第、的中・不的中を表示します。未取得や返還などの確認中は、成績に含めません。</p>}
        <footer><Link href={`/prediction/${p.prediction_id}`} prefetch={false}>予想と結果の詳細 →</Link>{source && <a href={source} target="_blank" rel="noopener noreferrer">公式結果 ↗</a>}</footer>
      </article>;
    })}</div>}
  </>;
}
