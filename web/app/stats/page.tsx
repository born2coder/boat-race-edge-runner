import { CircleOff, Info } from "lucide-react";
import { getForwardTopKStats, getObservationStats } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";

export const metadata = { title: "成績｜BOAT RACE EDGE" };

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const observation = await getObservationStats();
  const topK = await getForwardTopKStats();
  return (
    <section className="page-section">
      <div className="page-intro">
        <p className="section-kicker">PERFORMANCE</p>
        <h1>成績</h1>
        <p>実際に公開した3連単予想の的中率と回収率を、的中・不的中とも同じ条件で集計します。</p>
      </div>

      <section className="official-empty">
        <CircleOff aria-hidden="true" />
        <div><span>公開後の成績</span><h2>結果確定：{observation.settled}件</h2><p>{observation.settled === 0 ? "公開予想の結果はまだ確定していません。最初の結果が入るまで率は表示しません。" : "公開した全予想を、的中・不的中とも同じ条件で集計しています。"}</p></div>
      </section>

      <section className="stats-panel">
        <div className="section-heading split">
          <div><p className="section-kicker">PUBLIC RESULTS</p><h2>実際に公開した予想の成績</h2><p>1日最大10レース、3連単3点・各100円として記録します。</p></div>
          <span className="status-label purple">集計中</span>
        </div>
        <div className="metric-grid four stats">
          <article><span>公開した予想</span><strong>{observation.predictions}</strong><small>件</small></article>
          <article><span>結果確定</span><strong>{observation.settled}</strong><small>件</small></article>
          <article><span>的中</span><strong>{observation.hits}</strong><small>件</small></article>
          <article><span>3点予想の収支</span><strong className={observation.profit >= 0 ? "positive" : "negative"}>{formatYen(observation.profit)}</strong><small>{observation.returnRate == null ? "結果待ち" : `回収率 ${observation.returnRate.toFixed(1)}%`}</small></article>
        </div>
        <div className="metric-grid four stats">{topK.map((stat) => <article key={stat.k}><span>Top{stat.k}</span><strong>{stat.hitRate == null ? "—" : `${stat.hitRate.toFixed(1)}%`}</strong><small>{stat.settled ? `${stat.hits}/${stat.settled}・回収率 ${stat.returnRate?.toFixed(1)}%` : `${stat.k}点固定・結果待ち`}</small></article>)}</div>
      </section>

      <section className="stats-panel">
        <div className="section-heading split">
          <div><p className="section-kicker">PAST PERFORMANCE / 2026-05〜08</p><h2>過去データでの検証結果</h2><p>1,195レースを、現在と同じ買い目数で確認した参考成績です。</p></div>
          <span className="status-label purple">参考成績</span>
        </div>
        <div className="metric-grid four stats">
          <article><span>対象</span><strong>1,195</strong><small>レース</small></article>
          <article><span>Top1的中率</span><strong>17.15%</strong><small>1点固定</small></article>
          <article><span>Top3的中率</span><strong>41.17%</strong><small>3点固定</small></article>
          <article><span>Top5的中率</span><strong>54.56%</strong><small>5点固定</small></article>
          <article><span>Top8的中率</span><strong>64.77%</strong><small>8点固定</small></article>
          <article><span>Top3回収率</span><strong>87.85%</strong><small>払戻不明は0円</small></article>
          <article><span>1日の上限</span><strong>10</strong><small>レース</small></article>
          <article><span>3点予想</span><strong>3</strong><small>各100円</small></article>
        </div>
        <div className="formula-note"><Info aria-hidden="true" /> 回収率 = 払戻額 ÷ 購入額 × 100。Top3は各100円、1レース300円として計算します。</div>
      </section>

      <section className="sample-warning">
        <h2>これから実際の公開成績を積み上げます</h2>
        <p>過去成績だけでなく、公開後の予想をすべて残し、実際の的中率と回収率を確認していきます。</p>
      </section>
    </section>
  );
}
