import { aggregate, type Entry, type Filters } from "@/lib/four-page";
import {
  HistoryLink,
  number,
  yen,
  signedYen,
  percent,
  evText,
} from "@/components/four-page-common";
export function PerformanceKpis({
  entries,
  available,
}: {
  entries: Entry[];
  available: boolean;
}) {
  const a = aggregate(entries);
  const value = (n: number | null) => (available ? n : null);
  return (
    <>
      <div className="fp-kpis primary">
        <div className="fp-kpi roi">
          <span>回収率</span>
          <strong>
            {number(value(a.roi), 2)}
            <small>％</small>
          </strong>
          <span>結果確定分の仮想払戻 ÷ 仮想購入</span>
        </div>
        <div className="fp-kpi">
          <span>累計収支</span>
          <strong
            className={
              a.profit > 0 ? "fp-positive" : a.profit < 0 ? "fp-negative" : ""
            }
          >
            {signedYen(value(a.profit))}
          </strong>
        </div>
        <div className="fp-kpi">
          <span>総購入額（結果確定分）</span>
          <strong>{yen(value(a.stake))}</strong>
        </div>
        <div className="fp-kpi">
          <span>総払戻額（結果確定分）</span>
          <strong>{yen(value(a.payout))}</strong>
        </div>
      </div>
      <div className="fp-kpis secondary">
        {[
          ["購入買い目数", value(a.purchases), "点"],
          ["的中数", value(a.hits), "点"],
          ["的中率", value(a.hitRate), "％"],
          ["対象レース数", value(a.races), "R"],
          ["最大連続不的中（レース単位）", value(a.maxLosing), "R"],
          ["最大資金減少", value(a.drawdown), "円"],
        ].map(([label, v, unit]) => (
          <div className="fp-kpi" key={String(label)}>
            <span>{label}</span>
            <strong>
              {number(v as number | null, unit === "％" ? 2 : 0)}
              <small>{unit}</small>
            </strong>
          </div>
        ))}
      </div>
      <p className="fp-note">
        結果待ち・確認中 {available ? a.pending : "—"}点 ／ 仮想投入{" "}
        {yen(value(a.pendingStake))}。返還 {available ? a.refunds : "—"}点 ／{" "}
        {yen(value(a.refundAmount))}
        は主回収率の購入額・払戻額からともに除外します。
      </p>
    </>
  );
}
export function ProfitChart({ entries }: { entries: Entry[] }) {
  const a = aggregate(entries),
    values = a.curve.map((p) => p.profit),
    min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    range = max - min || 100;
  const x = (i: number) => 60 + (i / Math.max(1, values.length - 1)) * 620,
    y = (n: number) => 230 - ((n - min) / range) * 175;
  return (
    <section className="fp-card fp-chart">
      <h2>累計収支の推移</h2>
      {a.settled ? (
        <>
          <svg
            viewBox="0 0 720 280"
            role="img"
            aria-label={`累計仮想収支。開始0円、終了${signedYen(a.profit)}。最大資金減少${yen(a.drawdown)}。`}
          >
            <line x1="60" y1={y(0)} x2="680" y2={y(0)} stroke="#cbd9ec" />
            <text x="8" y={y(max)}>
              {" "}
              {number(max)}円
            </text>
            <text x="8" y={y(min)}>
              {" "}
              {number(min)}円
            </text>
            <polyline
              points={values.map((n, i) => `${x(i)},${y(n)}`).join(" ")}
              fill="none"
              stroke="#2279e6"
              strokeWidth="3"
            />
            <circle cx={680} cy={y(a.profit)} r="5" fill="#2279e6" />
            <text x="60" y="266">
              開始 0円
            </text>
            <text x="680" y="266" textAnchor="end">
              終了 {signedYen(a.profit)}
            </text>
          </svg>
          <details>
            <summary>推移の数値</summary>
            <ul>
              {a.curve.map((p, i) => (
                <li key={i}>
                  {p.at === "開始" ? p.at : p.at.replace("T", " ")}：
                  {signedYen(p.profit)}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <p className="fp-empty">結果確定した記録はまだありません。</p>
      )}
    </section>
  );
}
export type BreakdownRow = {
  label: string;
  entries: Entry[];
  overrides: Partial<Filters>;
};
export function Breakdown({
  title,
  rows,
  f,
  probability = false,
  expected = false,
}: {
  title: string;
  rows: BreakdownRow[];
  f: Filters;
  probability?: boolean;
  expected?: boolean;
}) {
  return (
    <section className="fp-card fp-breakdown">
      <h2>{title}</h2>
      <div className="fp-table">
        <div className="fp-table-head">
          <span>区分</span>
          <span>確定点数・的中率</span>
          <span>仮想購入・払戻</span>
          <span>収支・回収率</span>
          {expected && <span>平均事前期待回収率</span>}
        </div>
        {rows.map((row) => {
          const a = aggregate(row.entries);
          return (
            <div className="fp-table-row" key={row.label}>
              <div>
                <HistoryLink
                  f={f}
                  overrides={row.overrides}
                  label={row.label}
                />
              </div>
              <div>
                <span className="fp-mobile-label">確定点数・的中率 </span>
                {a.settled}点 ／ {number(a.hitRate, 2)}％
              </div>
              <div>
                <span className="fp-mobile-label">仮想購入・払戻 </span>
                {yen(a.stake)} ／ {yen(a.payout)}
              </div>
              <div>
                <strong
                  className={
                    a.profit > 0
                      ? "fp-positive"
                      : a.profit < 0
                        ? "fp-negative"
                        : ""
                  }
                >
                  {signedYen(a.profit)}
                </strong>
                <span> ／ {number(a.roi, 2)}％</span>
              </div>
              {expected && (
                <div>
                  <span className="fp-mobile-label">平均事前期待回収率 </span>
                  {evText(a.meanEv)}
                </div>
              )}
              {probability && (
                <details className="fp-probability-detail">
                  <summary>平均確率の内訳</summary>
                  <p>
                    推定確率 {percent(a.meanProbability)} ／ 補正確率{" "}
                    {percent(a.meanCalibrated)} ／ 保守確率{" "}
                    {percent(a.meanConservative)}
                  </p>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
