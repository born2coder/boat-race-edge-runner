import Link from "next/link";
import { ArrowRight, CalendarX2, CheckCircle2, Database, EyeOff, MapPin, ShieldCheck, TrendingUp } from "lucide-react";
import { PredictionCard } from "@/components/prediction-card";
import { TodayRaces } from "@/components/today-races";
import { racePhase } from "@/lib/race-lifecycle";
import { getPageFixture, getPerformancePeriods, getYesterdayResultDay } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "@/lib/site";

export const metadata = { alternates: { canonical: "/" } };

export const dynamic = "force-dynamic";

export default async function Home() {
  const [pageFixture, yesterdayResultDay, performancePeriods] = await Promise.all([
    getPageFixture(),
    getYesterdayResultDay(),
    getPerformancePeriods(),
  ]);
  const current = pageFixture.current_day;
  const now = Date.now();
  const upcomingCount = current.predictions.filter((p) => racePhase(p, now) === "upcoming").length;
  const isPassDay = current.recommended_count === 0;
  const isWaiting = current.status === "waiting";
  const yesterdayPredictions = yesterdayResultDay.predictions;
  const settledPredictions = yesterdayPredictions.filter((prediction) => prediction.official_performance_eligible && prediction.result?.settlement);
  const hitCount = settledPredictions.filter((prediction) => prediction.result?.settlement.hit).length;
  const totalStake = settledPredictions.reduce((sum, prediction) => sum + (prediction.result?.settlement.original_stake_yen ?? 0), 0);
  const totalReturn = settledPredictions.reduce((sum, prediction) => sum + (prediction.result?.settlement.gross_return_yen ?? 0), 0);
  const resultDateLabel = yesterdayResultDay.date.replaceAll("-", "/");

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, alternateName: "ふねのことわり", url: SITE_URL, description: SITE_DESCRIPTION, inLanguage: "ja" }).replace(/</g, "\\u003c") }} />
      <section className="hero-section">
        <div className="hero-ledger" aria-label="本日の判断">
          <span>本日の判断</span>
          <strong>{isWaiting ? "本日のデータを確認中です。" : isPassDay ? "今日は見送りです。" : upcomingCount ? `本日の予想はあと${upcomingCount}レースあります。` : "本日の予想はすべて締切済みです。"}</strong>
          <p>{isWaiting ? "公式配布データの到着を待っています。取得後、自動で全レースを分析します。" : <>本日開催の{current.analyzed_count}レースを分析しましたが、{isPassDay ? "現在の公開条件を満たしたレースはありませんでした。" : `現在の公開条件を満たした${current.recommended_count}レースを掲載しています。`}</>}</p>
          {isPassDay && !isWaiting && <b className="pass-message">無理に予想は出しません。</b>}
          <dl className="decision-metrics">
            <div><dt>分析済み</dt><dd>{current.analyzed_count}R</dd></div>
            <div><dt>公開予想</dt><dd>{current.recommended_count}R</dd></div>
            <div><dt>見送り</dt><dd>{current.skipped_count}R</dd></div>
          </dl>
        </div>

        <div className="hero-copy">
          <p className="section-kicker">舟の理 / ふねのことわり</p>
          <h1>
            <span>競艇の理を</span>
            <span>データで紐解き、</span>
            <span>予想を導く。</span>
          </h1>
          <p className="hero-lead">選手の成績、機力、レース内の力関係をデータで分析。全国のボートレースから厳選した競艇予想を、朝に最大10レース・各3点で無料公開します。買い目は後から変えず、的中・不的中まで記録します。</p>
          <div className="hero-promises" aria-label="このサイトの3つの特徴"><span>狙い目だけ厳選</span><span>買い目を記録</span><span>結果まで全公開</span></div>
        </div>
      </section>

      <section className="today-section" aria-labelledby="today-picks">
        <div className="section-heading venue-heading">
          <div><p className="section-kicker">TODAY / {current.date}</p><h2 id="today-picks">本日の予想</h2><p>朝に最大10レースを公開し、展示後も買い目は変更せず評価バッジだけを更新します。</p></div>
          <span className="status-label"><CheckCircle2 aria-hidden="true" /> {isWaiting ? "予想を準備中" : `締切前 ${upcomingCount}R`}</span>
        </div>

        {(current.excluded_prediction_count ?? 0) > 0 && <p role="note">公開が締切に間に合わなかった{current.excluded_prediction_count}件は、おすすめと成績集計から除外しています。記録は<Link href="/history">過去の予想</Link>に残しています。</p>}

        {isPassDay && current.venues.length > 0 ? (
          <details className="venue-disclosure">
            <summary>本日の開催場を見る <span>{current.venue_count}場</span></summary>
            <div className="venue-table-wrap"><table className="venue-table">
              <thead><tr><th>開催場</th><th>開催レース</th><th>予想公開</th></tr></thead>
              <tbody>{current.venues.map((venue) => <tr key={venue.venue_code}><td><MapPin aria-hidden="true" />{venue.venue}</td><td>{venue.race_count}R</td><td>{venue.target_races.length}R</td></tr>)}</tbody>
            </table></div>
          </details>
        ) : !isPassDay ? (
          <TodayRaces predictions={current.predictions} now={now} />
        ) : null}

        <div className="processing-note"><CheckCircle2 aria-hidden="true" /><span>{isWaiting ? "朝の最大10レース予想を準備しています。" : "朝の3点は固定です。終了後は予想と結果をそのまま掲載します。"}</span><small>展示評価を締切前に取得できなかった場合は「展示判定なし」と表示します。</small></div>
      </section>

      <section className="replay-section" aria-labelledby="yesterday-title">
        <div className="section-heading split">
          <div>
            <p className="section-kicker">YESTERDAY&apos;S PICKS / {resultDateLabel}</p>
            <h2 id="yesterday-title">昨日のおすすめと結果</h2>
            <p>{resultDateLabel}に実際に公開したおすすめを、的中・不的中ともそのまま掲載します。</p>
          </div>
          {yesterdayPredictions.length > 0 && <Link href="/history" className="text-link">昨日の全予想を見る <ArrowRight aria-hidden="true" /></Link>}
        </div>
        {yesterdayPredictions.length === 0 ? (
          <div className="official-empty yesterday-empty">
            <CalendarX2 aria-hidden="true" />
            <div><span>{resultDateLabel}</span><h3>昨日の公開予想はありません</h3><p>予想を公開した日の翌日から、ここに買い目と結果を表示します。</p></div>
          </div>
        ) : (
          <>
            <div className="metric-grid replay-metrics">
              <article><span>おすすめしたレース</span><strong>{yesterdayPredictions.length}</strong><small>レース</small></article>
              <article><span>結果確定・的中</span><strong>{hitCount}</strong><small>／{settledPredictions.length}レース</small></article>
              <article><span>使った金額</span><strong>{formatYen(totalStake)}</strong></article>
              <article><span>戻ってきた金額</span><strong>{formatYen(totalReturn)}</strong></article>
            </div>
            <div className="prediction-grid">
              {yesterdayPredictions.slice(0, 3).map((prediction) => <PredictionCard key={prediction.prediction_id} prediction={prediction} />)}
            </div>
          </>
        )}
      </section>

      <section className="summary-section performance-section" aria-labelledby="performance-title">
        <div className="section-heading split">
          <div><p className="section-kicker">HIT RATE</p><h2 id="performance-title">公開予想の的中率</h2><p>実際に公開した3連単3点予想を、結果が確定したレースだけで集計します。</p></div>
          <Link href="/stats" className="text-link">日別の成績・収支を見る <ArrowRight aria-hidden="true" /></Link>
        </div>
        <div className="metric-grid period-metrics">
          {performancePeriods.map((period) => (
            <article key={period.key} className={period.key === "month" ? "accent" : undefined}>
              <span>{period.label}の的中率</span>
              <strong>{period.hitRate == null ? "—" : `${period.hitRate.toFixed(1)}%`}</strong>
              <small>{period.settled ? `${period.hits}／${period.settled}レース的中` : "結果待ち"}</small>
              <p>{period.returnRate == null ? "回収率も結果確定後に表示" : `回収率 ${period.returnRate.toFixed(1)}%`}</p>
            </article>
          ))}
        </div>
        <div className="performance-note"><TrendingUp aria-hidden="true" /> 的中率は、公開後に結果が確定した予想だけを使い、的中・不的中をすべて含めて計算します。</div>
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
