import { BarChart3, ShieldCheck } from "lucide-react";
import { getPerformancePeriods } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";

export const metadata = { title: "成績｜BOAT RACE EDGE" };

export const dynamic = "force-dynamic";

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export default async function StatsPage() {
  const periods = await getPerformancePeriods();
  return (
    <section className="page-section">
      <div className="page-intro">
        <p className="section-kicker">PERFORMANCE</p>
        <h1>公開予想の成績</h1>
        <p>実際にサイトで公開した3連単3点予想について、今週・今月・今年の的中率を確認できます。</p>
      </div>

      <section className="stats-panel public-period-panel">
        <div className="section-heading split">
          <div><p className="section-kicker">HIT RATE</p><h2>期間別の的中率</h2><p>結果が確定したレースを分母にし、的中と不的中をすべて集計しています。</p></div>
          <span className="status-label purple"><BarChart3 aria-hidden="true" /> 毎日更新</span>
        </div>
        <div className="metric-grid period-metrics stats-period-metrics">
          {periods.map((period) => (
            <article key={period.key} className={period.key === "month" ? "accent" : undefined}>
              <span>{period.label}</span>
              <strong>{period.hitRate == null ? "—" : `${period.hitRate.toFixed(1)}%`}</strong>
              <small>{period.settled ? `${period.hits}／${period.settled}レース的中` : "結果待ち"}</small>
              <dl className="period-details">
                <div><dt>集計期間</dt><dd>{shortDate(period.startDate)}〜{shortDate(period.endDate)}</dd></div>
                <div><dt>購入額</dt><dd>{formatYen(period.stake)}</dd></div>
                <div><dt>払戻額</dt><dd>{formatYen(period.returned)}</dd></div>
                <div><dt>回収率</dt><dd>{period.returnRate == null ? "—" : `${period.returnRate.toFixed(1)}%`}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="official-empty stats-explanation">
        <ShieldCheck aria-hidden="true" />
        <div><span>集計ルール</span><h2>1レース3点・各100円で固定</h2><p>公開後に買い目を変えず、外れた予想も削除しません。まだ結果がない期間は、的中率を0%とはせず「結果待ち」と表示します。</p></div>
      </section>
    </section>
  );
}
