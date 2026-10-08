"use client";
import { useState } from "react";
import { aggregate, CATEGORY_LABELS, type Entry } from "@/lib/four-page";
import { venueNames } from "@/lib/venues";
import {
  evText,
  percent,
  stamp,
  yen,
  signedYen,
  outcomeLabels,
} from "@/components/four-page-common";
export function HistoryRaces({ groups }: { groups: Entry[][] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="fp-race-list">
      {groups.map((rows) => {
        const first = rows[0],
          a = aggregate(rows),
          expanded = Boolean(open[first.raceId]),
          id = "history-" + first.raceId.replaceAll(":", "-");
        const payout = rows.every((e) => e.payoutYen !== null)
          ? rows.reduce((s, e) => s + e.payoutYen!, 0)
          : null;
        const profit =
          payout === null
            ? null
            : payout - rows.reduce((s, e) => s + e.stakeYen, 0);
        return (
          <section
            className="fp-card fp-race-card"
            key={first.raceId}
            data-race={first.raceId}
          >
            <header>
              <div>
                <span>{first.raceDate}</span>
                <h2>
                  {venueNames[first.venueCode] ?? first.venueCode}{" "}
                  {first.raceNo}R
                </h2>
              </div>
              <div className="fp-race-summary">
                <span>
                  {rows.length}点・
                  {a.hits
                    ? `的中（${a.hits}/${a.settled}点）`
                    : a.pending
                      ? "結果待ち・確認中"
                      : a.refunds === rows.length
                        ? "返還"
                        : "不的中"}
                </span>
                <span>
                  確定結果{" "}
                  {rows.find((e) => e.resultCombination)?.resultCombination ??
                    "—"}
                </span>
                <strong
                  className={
                    profit !== null && profit > 0
                      ? "fp-positive"
                      : profit !== null && profit < 0
                        ? "fp-negative"
                        : ""
                  }
                >
                  仮想収支 {signedYen(profit)}
                </strong>
              </div>
            </header>
            <div className="fp-history-head" aria-hidden="true">
              <span>買い目・記録時判定</span>
              <span>保守確率</span>
              <span>記録時オッズ・期待回収率</span>
              <span>結果</span>
              <span>仮想購入・払戻・収支</span>
            </div>
            <div id={id}>
              {rows.map((e, i) => (
                <article
                  key={e.id}
                  hidden={i >= 4 && !expanded}
                  className="fp-history-row"
                  data-pick={e.combination}
                >
                  <div>
                    <strong className="fp-combination">{e.combination}</strong>
                    <span className={"fp-badge " + e.category}>
                      {CATEGORY_LABELS[e.category]}
                    </span>
                  </div>
                  <div className="fp-secondary">
                    <span className="fp-mobile-label">保守確率 </span>
                    {percent(e.conservativeProbability)}
                  </div>
                  <div className="fp-secondary">
                    <span className="fp-mobile-label">記録時オッズ </span>
                    {e.odds === null ? "—" : e.odds + "倍"}
                    <strong>{evText(e.ev)}</strong>
                  </div>
                  <div>
                    <span className={"fp-badge fp-result-" + e.outcome}>
                      {outcomeLabels[e.outcome]}
                    </span>
                  </div>
                  <div className="fp-accounting">
                    <span>仮想購入 {yen(e.stakeYen)}</span>
                    <span>仮想払戻 {yen(e.payoutYen)}</span>
                    <strong
                      className={
                        e.payoutYen !== null && e.payoutYen > e.stakeYen
                          ? "fp-positive"
                          : e.payoutYen !== null && e.payoutYen < e.stakeYen
                            ? "fp-negative"
                            : ""
                      }
                    >
                      {signedYen(
                        e.payoutYen === null ? null : e.payoutYen - e.stakeYen,
                      )}
                    </strong>
                  </div>
                  <details className="fp-row-details">
                    <summary>詳細</summary>
                    <div className="fp-detail-grid">
                      <p>
                        初回掲載：
                        {stamp(
                          e.events?.find(
                            (event) =>
                              event.label.includes("購入推奨") ||
                              event.label.includes("買ってもよい"),
                          )?.at ?? null,
                        )}
                        <br />
                        初回仮想購入：{stamp(e.recordedAt)}
                        <br />
                        オッズ取得：{stamp(e.sourceObservedAt)}
                        <br />
                        締切：{stamp(e.closeAt)}
                        <br />
                        残り時間：
                        {e.minutesToClose === null
                          ? "—"
                          : e.minutesToClose.toFixed(2) + "分"}
                      </p>
                      <p>
                        推定確率：{percent(e.probability)}
                        <br />
                        補正確率：{percent(e.calibratedProbability)}
                        （過去データ補正は未導入）
                        <br />
                        保守確率：{percent(e.conservativeProbability)}
                        <br />
                        記録時期待回収率：{evText(e.ev)}
                      </p>
                      <p>
                        最終取得オッズ：
                        {e.finalOdds === null ? "—" : e.finalOdds + "倍"}
                        <br />
                        確定オッズ：—（公式払戻で精算）
                        <br />
                        結果・精算：{stamp(e.settledAt)}
                        <br />
                        {e.ruleVersion} ／ {e.modelVersion}
                      </p>
                    </div>
                    <ol className="fp-timeline">
                      <li>
                        {stamp(e.recordedAt)} 初回仮想購入・
                        {CATEGORY_LABELS[e.category]}・仮想購入100円
                      </li>
                      {e.events?.map((event, j) => (
                        <li key={event.at + ":" + j}>
                          {stamp(event.at)} {event.label}
                          {event.odds !== null ? ` ／ ${event.odds}倍` : ""}
                          {event.ev !== null ? ` ／ ${evText(event.ev)}` : ""}
                        </li>
                      ))}
                      {e.closeAt && <li>{stamp(e.closeAt)} 締切</li>}
                      {e.settledAt && (
                        <li>
                          {stamp(e.settledAt)} {outcomeLabels[e.outcome]}・精算
                        </li>
                      )}
                    </ol>
                  </details>
                </article>
              ))}
            </div>
            {rows.length > 4 && (
              <button
                type="button"
                className="fp-expand"
                aria-expanded={expanded}
                aria-controls={id}
                onClick={() => setOpen({ ...open, [first.raceId]: !expanded })}
              >
                {expanded
                  ? "▲ 閉じる"
                  : `▼ 残り${rows.length - 4}点の買い目を表示`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
