import styles from "./calibration.module.css";

export type Policy = { tickets: number; hits: number; stake: number; payout: number; roi: number | null;
  supportedTickets?: number; unsupportedTickets?: number; evaluatedRaces?: number;
  maxDailyDrawdown?: number; top5PayoutShare?: number | null;
  daily?: { date: string; net: number; roi: number; tickets: number; hits: number }[] };
export type Comparison = { baseline: Policy; probability?: Policy; adjusted: Policy };
const labels = {baseline: "現行の計算", probability: "確率だけ補正", adjusted: "確率とオッズを補正"};
const pct = (n: number | null | undefined) => n == null ? "未評価" : `${(n * 100).toFixed(2)}％`;
const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export function StrategyComparison({data, title}: {data: Comparison; title: string}) {
  const rows = Object.entries(data) as [keyof typeof labels, Policy][];
  const max = Math.max(1, ...rows.map(([, p]) => p.roi ?? 0));
  return <section className={styles.strategy}>
    <h4>{title}</h4>
    <figure className={styles.chart}><figcaption>回収率の比較（100％が収支ゼロ）</figcaption>
      {rows.map(([key, p]) => <div className={styles.strategyBar} key={key}>
        <span>{labels[key]}</span><div className={styles.track}>
          {p.roi != null && <div className={key === "baseline" ? styles.before : styles.after} style={{width: `${p.roi / max * 100}%`}} />}
          <span className={styles.breakEven} style={{left: `${100 / max}%`}} aria-hidden="true" />
        </div><strong>{pct(p.roi)}</strong>
      </div>)}
    </figure>
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={title}><table>
      <thead><tr><th scope="col">計算方法</th><th scope="col">購入／的中</th><th scope="col">使った金額</th><th scope="col">払戻</th><th scope="col">収支</th><th scope="col">回収率</th></tr></thead>
      <tbody>{rows.map(([key,p]) => <tr key={key}><th scope="row">{labels[key]}</th><td>{p.supportedTickets === 0 ? "未評価" : `${p.tickets.toLocaleString("ja-JP")}／${p.hits}点`}</td><td>{p.supportedTickets === 0 ? "未評価" : yen(p.stake)}</td><td>{p.supportedTickets === 0 ? "未評価" : yen(p.payout)}</td><td>{p.supportedTickets === 0 ? "未評価" : yen(p.payout-p.stake)}</td><td>{pct(p.roi)}</td></tr>)}</tbody>
    </table></div>
    {data.baseline.supportedTickets === 0 ? <p>比較に必要なデータがまだありません。購入を見送ったという意味ではありません。</p> : data.baseline.tickets === 0 && <p>比較できた範囲では、現行の計算で購入条件を満たす買い目がありませんでした。</p>}
    {data.baseline.supportedTickets != null && <p className={styles.note}>比較対象：{data.baseline.evaluatedRaces}レース・{data.baseline.supportedTickets.toLocaleString("ja-JP")}通り。データ不足で未評価：{data.baseline.unsupportedTickets?.toLocaleString("ja-JP")}通り。</p>}
    <details><summary>日ごとの収支と、高額的中への偏りを見る</summary>
      {rows.map(([key,p]) => <div key={key}><h5>{labels[key]}</h5>
        <p>高額的中上位5点が払戻に占める割合：{pct(p.top5PayoutShare)} ／ 日末の累積収支が、それまでの最高額から減った最大額：{p.maxDailyDrawdown == null || p.supportedTickets === 0 ? "未評価" : yen(p.maxDailyDrawdown)}</p>
        {!p.daily?.length ? <p>日別成績はまだありません。</p> : <div className={styles.tableScroll}><table><thead><tr><th>日付</th><th>購入／的中</th><th>収支</th><th>回収率</th></tr></thead><tbody>{p.daily.map(d=><tr key={d.date}><th scope="row">{d.date}</th><td>{d.tickets}／{d.hits}</td><td>{yen(d.net)}</td><td>{pct(d.roi)}</td></tr>)}</tbody></table></div>}
      </div>)}
    </details>
  </section>;
}
