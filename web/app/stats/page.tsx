import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getPerformanceDetail } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";
import { racePhase } from "@/lib/race-lifecycle";

export const metadata = { title: "日別の成績・収支｜BOAT RACE EDGE" };
export const dynamic = "force-dynamic";

const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  const key = period === "week" || period === "year" ? period : "month";
  const stats = await getPerformanceDetail(key);
  const profit = stats.returned - stats.stake;
  return <section className="page-section">
    <div className="page-intro">
      <p className="section-kicker">DAILY PERFORMANCE</p>
      <h1>日別の成績と収支</h1>
      <p>いつ、何レース当たり、いくら戻ったのか。日ごとの内訳から、公開した予想まで確認できます。</p>
    </div>

    <nav className="performance-period-nav" aria-label="集計期間を選ぶ">
      {([['week', '今週'], ['month', '今月'], ['year', '今年']] as const).map(([value, label]) => <Link key={value} href={`/stats?period=${value}`} prefetch={false} aria-current={key === value ? "page" : undefined}>{label}</Link>)}
    </nav>

    <section className="today-result-total" aria-labelledby="period-summary-title">
      <h2 id="period-summary-title">{stats.label}の合計</h2>
      <p>{stats.startDate.replaceAll('-', '/')}〜{stats.endDate.replaceAll('-', '/')}・公開 {stats.published}レース／結果確定 {stats.settled}レース{stats.pending ? `／未確定 ${stats.pending}レース` : ''}</p>
      <dl className="today-total-grid">
        <div><dt>的中数</dt><dd>{stats.hits}<small>／{stats.settled}レース</small></dd></div>
        <div><dt>的中率</dt><dd>{percent(stats.hitRate)}</dd></div>
        <div><dt>仮想購入額</dt><dd>{formatYen(stats.stake)}</dd></div>
        <div><dt>仮想払戻額</dt><dd>{formatYen(stats.returned)}</dd></div>
        <div><dt>合計収支</dt><dd className={profit >= 0 ? 'positive' : 'negative'}>{formatYen(profit)}</dd></div>
        <div><dt>回収率</dt><dd>{percent(stats.returnRate)}</dd></div>
      </dl>
      <p>金額と割合は結果確定分のみ。未確定の予想は計算に含めません。</p>
    </section>

    <section className="performance-ledger" aria-labelledby="daily-ledger-title">
      <div className="section-heading split"><div><h2 id="daily-ledger-title">日別の内訳</h2><p>日付の行を開くと、その日の各レースと結果を確認できます。新しい日付から表示します。</p></div></div>
      {stats.days.length === 0 ? <div className="result-pending">この期間の公開予想はまだありません。</div> : <>
        <div className="ledger-columns" aria-hidden="true"><span>日付</span><span>的中／確定</span><span>的中率</span><span>日別収支</span><span>期間内累計収支</span><span>内訳</span></div>
        {stats.days.map((day) => <details className="ledger-day" key={day.date}>
          <summary>
            <strong>{day.date.replaceAll('-', '/')}</strong>
            <span><small>的中／確定</small>{day.hits}／{day.settled}R</span>
            <span><small>的中率</small>{percent(day.hitRate)}</span>
            <span className={day.returned - day.stake >= 0 ? 'positive' : 'negative'}><small>日別収支</small>{formatYen(day.returned - day.stake)}</span>
            <span><small>期間内累計</small>{formatYen(day.cumulativeProfit)}</span>
            <span className="ledger-toggle">内訳</span>
          </summary>
          <div className="ledger-day-body">
            <p>公開 {day.published}レース・結果確定 {day.settled}レース{day.pending ? `・未確定 ${day.pending}レース` : ''}</p>
            <p>仮想購入 {formatYen(day.stake)} → 仮想払戻 {formatYen(day.returned)}／回収率 {percent(day.returnRate)}</p>
            <div className="ledger-races">{day.predictions.map((p) => {
              const settlement = p.result?.settlement;
              return <Link href={`/prediction/${p.prediction_id}`} prefetch={false} key={p.prediction_id}>
                <span><strong>{p.race.venue} {p.race.race_no}R</strong><small>締切 {p.race.start_time_jst}</small></span>
                <span className={settlement ? settlement.hit ? 'result-hit' : 'result-miss' : undefined}>{settlement ? settlement.hit ? '的中' : '不的中' : racePhase(p) === 'upcoming' ? '締切前' : '結果確認中'}{settlement && <small>結果 {settlement.result_combination}</small>}</span>
                <span><small>収支</small>{settlement ? formatYen(settlement.profit_yen) : '—'}</span>
                <span className="ledger-race-link">予想と結果を見る →</span>
              </Link>;
            })}</div>
          </div>
        </details>)}
        <p className="ledger-footnote">期間内累計収支は、選んだ期間の初日から各日までの合計です。公開予想がある日のみ表示しています。</p>
      </>}
    </section>

    <section className="official-empty stats-explanation">
      <ShieldCheck aria-hidden="true" />
      <div><span>集計ルール</span><h2>1レース3点・各100円で固定</h2><p>的中率＝的中数÷結果確定数。回収率＝払戻額÷購入額。締切前に公開できた予想のみ集計し、外れた予想も残します。結果がない期間の割合は「—」で表示します。</p><Link href="/history">公開した予想の全記録を見る →</Link></div>
    </section>
  </section>;
}
