import type { EdgeCandidate } from "@/db/live-repository";

function snapshots(candidate: EdgeCandidate) {
  const recorded = candidate.odds_snapshots?.length ? candidate.odds_snapshots : [{
    label: "t20" as const,
    target_minutes: 20,
    minutes_before: 20,
    odds_decimal: candidate.odds_decimal,
    expected_value_percent: candidate.expected_value_percent,
    observed_at: candidate.observed_at,
  }];
  return [...recorded].sort((left, right) => right.target_minutes - left.target_minutes);
}

export function oddsMovement(candidate: EdgeCandidate) {
  const recorded = snapshots(candidate);
  const initial = recorded[0];
  const latest = recorded.at(-1) ?? initial;
  const changePercent = initial.odds_decimal > 0
    ? (latest.odds_decimal / initial.odds_decimal - 1) * 100
    : 0;
  const label = recorded.length < 2
    ? "再確認待ち"
    : latest.expected_value_percent < candidate.threshold_percent
      ? "基準割れ"
      : changePercent <= -5
        ? "低下"
        : "維持";
  return { recorded, initial, latest, changePercent, label };
}

export function OddsTimeline({ candidate, includeFinal = false }: { candidate: EdgeCandidate; includeFinal?: boolean }) {
  const movement = oddsMovement(candidate);
  const finalOdds = includeFinal && candidate.hit && candidate.payout_per_100_yen != null
    ? candidate.payout_per_100_yen / 100
    : null;
  const finalChange = finalOdds == null ? null : (finalOdds / movement.initial.odds_decimal - 1) * 100;

  return <div className="edge-odds-wrap">
    <div className={`edge-odds-status ${movement.label === "基準割れ" ? "below" : movement.label === "低下" ? "down" : ""}`}>
      <span>{movement.label}</span>
      {movement.recorded.length > 1 && <small>{movement.changePercent >= 0 ? "+" : ""}{movement.changePercent.toFixed(1)}%</small>}
    </div>
    <div className="edge-odds-timeline" aria-label={`${candidate.combination}のオッズ推移`}>
      {movement.recorded.map((snapshot, index) => <div key={`${snapshot.label}-${snapshot.observed_at}`}>
        {index > 0 && <i aria-hidden="true">→</i>}
        <span>約{snapshot.target_minutes}分前</span>
        <strong>{snapshot.odds_decimal.toFixed(1)}倍</strong>
        <small>実測 {snapshot.minutes_before.toFixed(1)}分前</small>
        <small>期待値 {snapshot.expected_value_percent.toFixed(0)}%</small>
      </div>)}
      {finalOdds != null && <div className="final">
        <i aria-hidden="true">→</i>
        <span>確定倍率</span>
        <strong>{finalOdds.toFixed(1)}倍</strong>
        <small>{finalChange == null ? "" : `判定時比 ${finalChange >= 0 ? "+" : ""}${finalChange.toFixed(1)}%`}</small>
      </div>}
    </div>
  </div>;
}
