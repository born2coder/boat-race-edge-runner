import styles from "./calibration.module.css";

export type Policy = { tickets: number; hits: number; stake: number; payout: number; roi: number | null;
  supportedTickets?: number; unsupportedTickets?: number; evaluatedRaces?: number;
  maxDailyDrawdown?: number; top5PayoutShare?: number | null;
  daily?: { date: string; net: number; roi: number; tickets: number; hits: number }[] };
export type Comparison = { baseline: Policy; probability?: Policy; adjusted: Policy };
export type FactorialData = Record<"raw080" | "raw100" | "calibrated080" | "calibrated100", Policy>;
export type MarketData = Record<"marketBaseline" | "oddsUnder20" | "gapUnder3" | "under20Gap3" | "blend50", Policy>;
const labels = {baseline: "現行の計算", probability: "確率補正・係数なし", adjusted: "確率とオッズを補正",
  raw080: "A 元確率 ×0.8", raw100: "B 元確率 ×1.0", calibrated080: "C 補正確率 ×0.8", calibrated100: "D 補正確率 ×1.0",
  marketBaseline: "現行方式（比較基準）", oddsUnder20: "20倍未満", gapUnder3: "市場との乖離3倍未満",
  under20Gap3: "20倍未満＋乖離3倍未満", blend50: "モデルと市場を半分ずつ"};
const pct = (n: number | null | undefined) => n == null ? "未評価" : `${(n * 100).toFixed(2)}％`;
const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export function StrategyComparison({data, title}: {data: Comparison | FactorialData | MarketData; title: string}) {
  const rows = Object.entries(data) as [keyof typeof labels, Policy][];
  const baseline = "baseline" in data ? data.baseline : "marketBaseline" in data ? data.marketBaseline : data.raw080;
  const max = Math.max(1, ...rows.map(([, p]) => p.roi ?? 0));
  return <section className={styles.strategy}>
    <h4>{title}</h4>
    <figure className={styles.chart}><figcaption>回収率の比較（100％が収支ゼロ）</figcaption>
      {rows.map(([key, p]) => <div className={styles.strategyBar} key={key}>
        <span>{labels[key]}</span><div className={styles.track}>
          {p.roi != null && <div className={key === "baseline" || key === "marketBaseline" ? styles.before : styles.after} style={{width: `${p.roi / max * 100}%`}} />}
          <span className={styles.breakEven} style={{left: `${100 / max}%`}} aria-hidden="true" />
        </div><strong>{pct(p.roi)}</strong>
      </div>)}
    </figure>
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={title}><table>
      <thead><tr><th scope="col">計算方法</th><th scope="col">購入／的中</th><th scope="col">使った金額</th><th scope="col">払戻</th><th scope="col">収支</th><th scope="col">回収率</th></tr></thead>
      <tbody>{rows.map(([key,p]) => <tr key={key}><th scope="row">{labels[key]}</th><td>{p.supportedTickets === 0 ? "未評価" : `${p.tickets.toLocaleString("ja-JP")}／${p.hits}点`}</td><td>{p.supportedTickets === 0 ? "未評価" : yen(p.stake)}</td><td>{p.supportedTickets === 0 ? "未評価" : yen(p.payout)}</td><td>{p.supportedTickets === 0 ? "未評価" : yen(p.payout-p.stake)}</td><td>{pct(p.roi)}</td></tr>)}</tbody>
    </table></div>
    {baseline.supportedTickets === 0 ? <p>比較に必要なデータがまだありません。購入を見送ったという意味ではありません。</p> : baseline.tickets === 0 && <p>比較できた範囲では、比較基準の計算で購入条件を満たす買い目がありませんでした。</p>}
    {baseline.supportedTickets != null && <p className={styles.note}>比較対象：{baseline.evaluatedRaces}レース・{baseline.supportedTickets.toLocaleString("ja-JP")}通り。データ不足で未評価：{baseline.unsupportedTickets?.toLocaleString("ja-JP")}通り。</p>}
    <details><summary>日ごとの収支と、高額的中への偏りを見る</summary>
      {rows.map(([key,p]) => <div key={key}><h5>{labels[key]}</h5>
        <p>高額的中上位5点が払戻に占める割合：{pct(p.top5PayoutShare)} ／ 日末の累積収支が、それまでの最高額から減った最大額：{p.maxDailyDrawdown == null || p.supportedTickets === 0 ? "未評価" : yen(p.maxDailyDrawdown)}</p>
        {!p.daily?.length ? <p>日別成績はまだありません。</p> : <div className={styles.tableScroll}><table><thead><tr><th>日付</th><th>購入／的中</th><th>収支</th><th>回収率</th></tr></thead><tbody>{p.daily.map(d=><tr key={d.date}><th scope="row">{d.date}</th><td>{d.tickets}／{d.hits}</td><td>{yen(d.net)}</td><td>{pct(d.roi)}</td></tr>)}</tbody></table></div>}
      </div>)}
    </details>
  </section>;
}

export function MarketComparison({data, title}: {data: MarketData; title: string}) {
  const baseline = data.marketBaseline;
  return <>
    <StrategyComparison data={data} title={title} />
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${title}：現行方式との差`}><table>
      <caption>現行方式から、購入点数と収支はどう変わった？</caption>
      <thead><tr><th scope="col">購入条件</th><th scope="col">回収率の差</th><th scope="col">購入点数の差</th><th scope="col">収支の差</th></tr></thead>
      <tbody>{(Object.keys(data) as (keyof MarketData)[]).filter(key => key !== "marketBaseline").map(key => {
        const p = data[key], available = baseline.supportedTickets !== 0 && p.supportedTickets !== 0;
        const delta = baseline.roi == null || p.roi == null ? null : (p.roi - baseline.roi) * 100;
        return <tr key={key}><th scope="row">{labels[key]}</th>
          <td>{delta == null ? "未評価" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}ポイント`}</td>
          <td>{available ? `${p.tickets - baseline.tickets}点` : "未評価"}</td>
          <td>{available ? yen((p.payout - p.stake) - (baseline.payout - baseline.stake)) : "未評価"}</td></tr>;
      })}</tbody>
    </table></div>
  </>;
}

const pairs = [
  ["確率を補正する（×0.8で固定）", "raw080", "calibrated080", "A → C"],
  ["確率を補正する（×1.0で固定）", "raw100", "calibrated100", "B → D"],
  ["×0.8を外す（元確率で固定）", "raw080", "raw100", "A → B"],
  ["×0.8を外す（補正確率で固定）", "calibrated080", "calibrated100", "C → D"],
] as const;
export function FactorialComparison({data, title}: {data: FactorialData; title: string}) {
  return <>
    <StrategyComparison data={data} title={title} />
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${title}：効果を分けて比較`}><table>
      <caption>一方の条件を固定したときの変化</caption>
      <thead><tr><th scope="col">変えた条件</th><th scope="col">比較</th><th scope="col">回収率の差</th><th scope="col">購入点数の差</th><th scope="col">収支の差</th></tr></thead>
      <tbody>{pairs.map(([label, before, after, direction]) => {
        const a = data[before], b = data[after], available = a.supportedTickets !== 0 && b.supportedTickets !== 0;
        const delta = a.roi == null || b.roi == null ? null : (b.roi - a.roi) * 100;
        return <tr key={label}><th scope="row">{label}</th><td>{direction}</td>
          <td>{delta == null ? "未評価" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}ポイント`}</td>
          <td>{available ? `${b.tickets - a.tickets}点` : "未評価"}</td>
          <td>{available ? yen((b.payout - b.stake) - (a.payout - a.stake)) : "未評価"}</td></tr>;
      })}</tbody>
    </table></div>
    <p className={styles.note}>購入点数は条件によって変わります。回収率が上がっても損失額が増える場合があるため、収支の差も併せて確認してください。少数の的中だけで効果を断定しません。</p>
  </>;
}
