"use client";

import { useState } from "react";
import type { TypeGPair } from "@/db/live-repository";
import { formatYen } from "@/lib/poc";

function top3(prediction: TypeGPair["typeG"] | null) {
  return prediction?.tickets.slice(0, 3).map((ticket) => ticket.combination) ?? [];
}

function isHit(pair: TypeGPair) {
  return Boolean(pair.typeG.result && top3(pair.typeG).includes(pair.typeG.result.combination));
}

function PairRows({ pair }: { pair: TypeGPair }) {
  const typeG = top3(pair.typeG);
  const control = top3(pair.control);
  return <div className="type-g-pair">
    <div><span>現行HIT</span><div>{control.map((combination) => <b className={!typeG.includes(combination) ? "removed" : ""} key={combination}>{combination}</b>)}</div></div>
    <div><span>type-G</span><div>{typeG.map((combination) => <b className={!control.includes(combination) ? "added" : ""} key={combination}>{combination}</b>)}</div></div>
  </div>;
}

function ResultRow({ pair }: { pair: TypeGPair }) {
  const result = pair.typeG.result;
  const hit = isHit(pair);
  const controlHit = Boolean(result && top3(pair.control).includes(result.combination));
  const payout = result?.payout_per_100_yen ?? 0;
  return <details className={`type-g-result-row ${hit ? "hit" : ""}`}>
    <summary>
      <span>{pair.typeG.race.race_date.replaceAll("-", "/")} {pair.typeG.race.start_time_jst}</span>
      <strong>{pair.typeG.race.venue} {pair.typeG.race.race_no}R</strong>
      <b>{result ? (hit ? "type-G的中" : "不的中") : "結果確認中"}</b>
      <span>{result ? `結果 ${result.combination}` : "公式結果待ち"}</span>
      <span>購入 3点・¥300</span>
      <span>{result ? `払戻 ${formatYen(hit ? payout : 0)}` : "払戻 —"}</span>
    </summary>
    <div className="type-g-result-detail">
      <PairRows pair={pair} />
      {result && <div className="type-g-settlement">
        <span>現行HIT {controlHit ? `的中・${formatYen(payout)}` : "不的中"}</span>
        <span>type-G {hit ? `的中・${formatYen(payout)}` : "不的中"}</span>
      </div>}
      <details className="type-g-more"><summary>Top5・Top8まで確認</summary><div>{pair.typeG.tickets.map((ticket, index) => <span key={ticket.combination}><small>{index + 1}</small>{ticket.combination}</span>)}</div></details>
    </div>
  </details>;
}

export function TypeGLedger({ pairs }: { pairs: TypeGPair[] }) {
  const [filter, setFilter] = useState<"all" | "changed" | "hit">("all");
  const changed = pairs.filter((pair) => pair.changedTop3);
  const hits = pairs.filter(isHit);
  const visible = filter === "changed" ? changed : filter === "hit" ? hits : pairs;
  return <>
    <div className="type-g-filters" aria-label="type-G検証結果の絞り込み">
      <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>すべて <span>{pairs.length}</span></button>
      <button type="button" aria-pressed={filter === "changed"} onClick={() => setFilter("changed")}>買い目変更 <span>{changed.length}</span></button>
      <button type="button" aria-pressed={filter === "hit"} onClick={() => setFilter("hit")}>的中のみ <span>{hits.length}</span></button>
    </div>
    {visible.length ? <div className="type-g-result-list">{visible.slice(0, 120).map((pair) => <ResultRow pair={pair} key={pair.raceId} />)}</div> : <p className="type-g-empty-filter">該当するレースはありません。</p>}
  </>;
}
