"use client";

import { useState } from "react";
import type { EdgeCandidate } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";

export type EdgeRaceGroup = {
  race_id: string;
  venue_name: string;
  race_no: number;
  start_at: string;
  candidates: EdgeCandidate[];
};

const dateLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short" }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function PickList({ candidates }: { candidates: EdgeCandidate[] }) {
  return <div className="edge-pick-list">{candidates.map((candidate) => <section className={`edge-pick ${candidate.hit ? "hit" : ""}`} key={candidate.edge_id}>
    <div className="edge-pick-heading"><strong>{candidate.combination}</strong>{candidate.hit && <span>的中</span>}</div>
    <dl>
      <div><dt>確率</dt><dd>{(candidate.predicted_probability * 100).toFixed(1)}%</dd></div>
      <div><dt>オッズ</dt><dd>{candidate.odds_decimal.toFixed(1)}倍</dd></div>
      <div><dt>期待値</dt><dd>{candidate.expected_value_percent.toFixed(0)}%</dd></div>
    </dl>
  </section>)}</div>;
}

function HistoryRaceRow({ group, now }: { group: EdgeRaceGroup; now: string }) {
  const settled = group.candidates.every((candidate) => candidate.status === "settled");
  const hit = group.candidates.some((candidate) => candidate.hit);
  const pending = !settled && Date.parse(group.start_at) <= Date.parse(now);
  const result = group.candidates.find((candidate) => candidate.status === "settled");
  const purchaseYen = group.candidates.length * 100;
  const payout = hit ? (result?.payout_per_100_yen ?? 0) : 0;

  return <details className={`edge-history-row ${hit ? "hit" : ""}`}>
    <summary>
      <span className="edge-history-date">{dateLabel(group.start_at)} {timeLabel(group.start_at)}</span>
      <strong>{group.venue_name} {group.race_no}R</strong>
      <b>{settled ? (hit ? "的中" : "不的中") : pending ? "結果確認中" : "記録中"}</b>
      <span className="edge-history-result">{settled ? `結果 ${result?.result_combination ?? "—"}` : "公式結果待ち"}</span>
      <span className="edge-history-stake">購入 {group.candidates.length}点・{formatYen(purchaseYen)}</span>
      <span className={`edge-history-payout ${hit ? "hit" : ""}`}>{settled ? `払戻 ${formatYen(payout)}` : "払戻 —"}</span>
    </summary>
    <div className="edge-history-detail">
      <PickList candidates={group.candidates} />
      {settled && <p className="edge-settlement">購入 <strong>{group.candidates.length}点・{formatYen(purchaseYen)}</strong> ／ 払戻 <strong>{formatYen(payout)}</strong></p>}
      {pending && <p className="edge-settlement pending">購入 {group.candidates.length}点・{formatYen(purchaseYen)}。公式結果を確認しています。</p>}
      <small>判定 {new Date(group.candidates[0].observed_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</small>
    </div>
  </details>;
}

export function HistoryLedger({ groups, now }: { groups: EdgeRaceGroup[]; now: string }) {
  const [hitsOnly, setHitsOnly] = useState(false);
  const hitCount = groups.filter((group) => group.candidates.some((candidate) => candidate.hit)).length;
  const visibleGroups = hitsOnly ? groups.filter((group) => group.candidates.some((candidate) => candidate.hit)) : groups;

  return <>
    <div className="edge-history-filters" aria-label="検証結果の表示切り替え">
      <button type="button" aria-pressed={!hitsOnly} onClick={() => setHitsOnly(false)}>すべて <span>{groups.length}</span></button>
      <button type="button" aria-pressed={hitsOnly} onClick={() => setHitsOnly(true)}>的中のみ <span>{hitCount}</span></button>
    </div>
    {visibleGroups.length === 0 ? <p className="edge-filter-empty">該当する的中レースはありません。</p> : <div className="edge-history-list">{visibleGroups.map((group) => <HistoryRaceRow group={group} now={now} key={group.race_id} />)}</div>}
  </>;
}
