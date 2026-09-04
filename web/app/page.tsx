import Link from "next/link";
import { ArrowRight, CheckCircle2, Database, EyeOff, MapPin, ShieldCheck } from "lucide-react";
import { PredictionCard } from "@/components/prediction-card";
import { ReassessmentBadge } from "@/components/reassessment-badge";
import { getPageFixture, getRecentResultDay } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [pageFixture, recentResultDay] = await Promise.all([getPageFixture(), getRecentResultDay()]);
  const current = pageFixture.current_day;
  const isPassDay = current.recommended_count === 0;
  const isWaiting = current.status === "waiting";
  const recentPredictions = recentResultDay.predictions;
  const settledPredictions = recentPredictions.filter((prediction) => prediction.result?.settlement);
  const hitCount = settledPredictions.filter((prediction) => prediction.result?.settlement.hit).length;
  const totalStake = settledPredictions.reduce((sum, prediction) => sum + (prediction.result?.settlement.original_stake_yen ?? 0), 0);
  const totalReturn = settledPredictions.reduce((sum, prediction) => sum + (prediction.result?.settlement.gross_return_yen ?? 0), 0);
  const previousDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(new Date(`${current.date}T12:00:00+09:00`).getTime() - 86_400_000));
  const isPreviousDay = recentResultDay.source === "published" && recentResultDay.date === previousDate;
  const resultDateLabel = recentResultDay.date.replaceAll("-", "/");

  return (
    <>
      <section className="hero-section">
        <div className="hero-ledger" aria-label="本日の判断">
          <span>本日の判断</span>
          <strong>{isWaiting ? "本日のデータを確認中です。" : isPassDay ? "今日は見送りです。" : `${current.recommended_count}Rを公開します。`}</strong>
          <p>{isWaiting ? "公式配布データの到着を待っています。取得後、自動で全レースを分析します。" : <>本日開催の{current.analyzed_count}レースを分析しましたが、{isPassDay ? "現在の公開条件を満たしたレースはありませんでした。" : `現在の公開条件を満たした${current.recommended_count}レースを掲載しています。`}</>}</p>
          {isPassDay && !isWaiting && <b className="pass-message">無理に予想は出しません。</b>}
          <dl className="decision-metrics">
            <div><dt>分析済み</dt><dd>{current.analyzed_count}R</dd></div>
            <div><dt>公開予想</dt><dd>{current.recommended_count}R</dd></div>
            <div><dt>見送り</dt><dd>{current.skipped_count}R</dd></div>
          </dl>
        </div>

        <div className="hero-copy">
          <p className="section-kicker">DATA-DRIVEN BOAT RACE PICKS</p>
          <h1>
            <span>データで徹底分析。</span>
            <span className="hero-highlight">回収率アップを狙う</span>
            <span>厳選予想を提供中！</span>
          </h1>
          <p className="hero-lead">全レースをむやみに予想しません。狙い目と判断したレースだけをお届けし、買い目も結果もすべて公開。<strong>嘘なし・ごまかしなし</strong>で、回収率を追い続けます。</p>
          <div className="hero-promises" aria-label="このサイトの3つの特徴"><span>狙い目だけ厳選</span><span>買い目を記録</span><span>結果まで全公開</span></div>
        </div>
      </section>

      <section className="today-section" aria-labelledby="today-picks">
        <div className="section-heading venue-heading">
          <div><p className="section-kicker">TODAY / {current.date}</p><h2 id="today-picks">本日の予想</h2><p>朝に10レースを公開し、展示後も買い目は変更せず評価バッジだけを更新します。</p></div>
          <span className="status-label"><CheckCircle2 aria-hidden="true" /> {isWaiting ? "予想を準備中" : `公開中 ${current.recommended_count}R`}</span>
        </div>

        {isPassDay && current.venues.length > 0 ? (
          <details className="venue-disclosure">
            <summary>本日の開催場を見る <span>{current.venue_count}場</span></summary>
            <div className="venue-table-wrap"><table className="venue-table">
              <thead><tr><th>開催場</th><th>開催レース</th><th>予想公開</th></tr></thead>
              <tbody>{current.venues.map((venue) => <tr key={venue.venue_code}><td><MapPin aria-hidden="true" />{venue.venue}</td><td>{venue.race_count}R</td><td>{venue.target_races.length}R</td></tr>)}</tbody>
            </table></div>
          </details>
        ) : !isPassDay ? (
          <div className="venue-target-grid">
            {current.venues.filter((venue) => venue.target_races.length > 0).map((venue) => (
              <article className="venue-target-card has-targets" key={venue.venue_code}>
                <header><div className="venue-name"><span className="venue-code">{venue.venue_code}</span><div><MapPin aria-hidden="true" /><strong>{venue.venue}</strong></div></div><span className="venue-count is-active">公開 {venue.target_races.length}</span></header>
                <ul className="venue-race-list">{venue.target_races.map((race) => <li key={race.race_id}><Link href={`/prediction/${race.prediction_id}`}><span>{race.race_no}R</span><strong>{race.race_name}</strong><small>{race.start_time_jst}</small><ReassessmentBadge status={race.reassessment_status} waiting={!race.reassessment_status} compact /><ArrowRight aria-hidden="true" /></Link></li>)}</ul>
                <footer>{venue.race_count}レース開催</footer>
              </article>
            ))}
          </div>
        ) : null}

        <div className="processing-note"><CheckCircle2 aria-hidden="true" /><span>{isWaiting ? "朝の10レース予想を準備しています。" : "朝の買い目を固定公開しています。展示後はバッジだけを更新します。"}</span><small>展示後も3連単3点の買い目は変更しません。</small></div>
      </section>

      <section className="replay-section" aria-labelledby="replay-title">
        <div className="section-heading split">
          <div>
            <p className="section-kicker">PICKS & RESULTS / {resultDateLabel}</p>
            <h2 id="replay-title">
              {recentResultDay.source === "historical_sample" ? "予想と結果の見本" : isPreviousDay ? "前日の予想と結果" : "直近の予想と結果"}
            </h2>
            <p>
              {recentResultDay.source === "historical_sample"
                ? "公開予想の実績がたまるまで、過去データで試した予想を見本として掲載しています。"
                : `${resultDateLabel}に公開した買い目と、実際のレース結果です。`}
              選手名、3連単3点、着順、払戻までレースごとに確認できます。
            </p>
            {recentResultDay.source === "historical_sample" && <p className="replay-caution">実際に事前公開した予想成績ではありません。</p>}
          </div>
          <Link href="/history" className="text-link">予想と結果をすべて見る <ArrowRight aria-hidden="true" /></Link>
        </div>
        <div className="metric-grid replay-metrics">
          <article><span>予想したレース</span><strong>{settledPredictions.length}</strong><small>レース</small></article>
          <article><span>当たったレース</span><strong>{hitCount}</strong><small>レース</small></article>
          <article><span>使った金額</span><strong>{formatYen(totalStake)}</strong></article>
          <article><span>戻ってきた金額</span><strong>{formatYen(totalReturn)}</strong></article>
        </div>
        <div className="prediction-grid">
          {recentPredictions.slice(0, 3).map((prediction) => <PredictionCard key={prediction.prediction_id} prediction={prediction} />)}
        </div>
      </section>

      <section className="trust-section" aria-labelledby="trust-title">
        <div className="section-heading"><div><p className="section-kicker">OUR POLICY</p><h2 id="trust-title">当たった予想ではなく、出した予想を全部残す</h2></div></div>
        <div className="trust-grid">
          <article><ShieldCheck aria-hidden="true" /><strong>公開後は書き換えません</strong><p>予想・買い目・金額を記録し、訂正が必要な場合も履歴を残します。</p></article>
          <article><Database aria-hidden="true" /><strong>不的中も同じように残します</strong><p>良い結果だけを選ばず、試算・公開した全件を確認できます。</p></article>
          <article><EyeOff aria-hidden="true" /><strong>見送る日も明確にします</strong><p>条件に合わなければ、無理に買い目を作らず見送りとして記録します。</p></article>
        </div>
      </section>
    </>
  );
}
