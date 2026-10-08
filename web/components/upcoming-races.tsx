"use client";
import { useEffect, useState } from "react";
import { classify, CATEGORY_LABELS, type Observation } from "@/lib/four-page";
import { venueNames } from "@/lib/venues";
import {
  evText,
  percent,
  stamp,
  oddsText,
} from "@/components/four-page-common";
export function UpcomingRaces({
  observations,
  stopped,
  error,
}: {
  observations: Observation[];
  stopped: boolean;
  error: string | null;
}) {
  const [now, setNow] = useState<number | null>(null),
    [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (stopped) return;
    const update = () => {
      if (!document.hidden) setNow(Date.now());
    };
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [stopped]);
  if (stopped)
    return (
      <div className="fp-empty">
        <strong>取得停止中</strong>
        <p>
          古い買い目を現在有効な購入推奨として表示しません。自動更新はオフです。
        </p>
      </div>
    );
  if (error) return null;
  if (now === null) return <div className="fp-empty">データ確認中</div>;
  const eligible = observations
    .map((o) => ({ o, a: classify(o, now) }))
    .filter((x) => x.a.category !== "excluded");
  const races = new Map<string, typeof eligible>();
  for (const row of eligible)
    races.set(row.o.raceId, [...(races.get(row.o.raceId) ?? []), row]);
  const ordered = [...races.values()].sort(
    (a, b) =>
      Date.parse(a[0].o.closeAt!) - Date.parse(b[0].o.closeAt!) ||
      a[0].o.raceId.localeCompare(b[0].o.raceId, undefined, { numeric: true }),
  );
  if (!ordered.length) {
    const stale = observations.some(
      (o) =>
        Date.parse(o.closeAt ?? "") > now &&
        classify(o, now).reasons.some(
          (r) => r.includes("鮮度") || r.includes("未取得"),
        ),
    );
    return (
      <div className="fp-empty">
        <strong>
          {stale
            ? "データ確認中（オッズの鮮度・欠損）"
            : "現在、表示条件を満たす買い目はありません"}
        </strong>
      </div>
    );
  }
  return (
    <div className="fp-race-list">
      {ordered.map((rows) => {
        rows.sort(
          (a, b) =>
            (b.a.ev ?? 0) - (a.a.ev ?? 0) ||
            (b.o.conservativeProbability ?? 0) -
              (a.o.conservativeProbability ?? 0) ||
            a.o.combination.localeCompare(b.o.combination),
        );
        const first = rows[0].o;
        const [, , venue, rno] = first.raceId.split(":");
        const recommended = rows.filter((x) => x.a.category === "recommended"),
          optional = rows.filter((x) => x.a.category === "optional");
        const seconds = Math.max(
          0,
          Math.ceil((Date.parse(first.closeAt!) - now) / 1000),
        );
        const id = "optional-" + first.raceId.replaceAll(":", "-");
        const pick = (row: (typeof rows)[number]) => (
          <div className="fp-pick" key={row.o.combination}>
            <strong className="fp-combination">{row.o.combination}</strong>
            <div>
              <span className="fp-small-label">期待回収率</span>
              <strong className="fp-ev">{evText(row.a.ev)}</strong>
            </div>
            <div>
              <span className="fp-small-label">保守確率</span>
              <strong>{percent(row.o.conservativeProbability)}</strong>
            </div>
            <div>
              <span className="fp-small-label">現在オッズ</span>
              <strong>{oddsText(row.o.odds)}</strong>
            </div>
            <details>
              <summary>確率の内訳・取得時刻</summary>
              <p>補正確率：—（過去データ補正は未導入）</p>
              <p>
                推定確率：{percent(row.o.probability)} ／ 保守確率＝推定確率 ×
                0.8
              </p>
              <p>オッズ取得：{stamp(row.o.observedAt)}</p>
              <p>予想生成：{stamp(row.o.generatedAt)}</p>
              <p>
                版：{row.o.modelVersion} ／ {row.o.ruleVersion}
              </p>
            </details>
          </div>
        );
        return (
          <section
            className="fp-card fp-race-card"
            key={first.raceId}
            data-race={first.raceId}
          >
            <header>
              <h2>
                {venueNames[venue] ?? venue} {rno}R
              </h2>
              <div>
                <span>
                  締切{" "}
                  {new Intl.DateTimeFormat("ja-JP", {
                    timeZone: "Asia/Tokyo",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(first.closeAt!))}
                </span>
                <strong className="fp-countdown">
                  あと{Math.floor(seconds / 60)}分{seconds % 60}秒
                </strong>
              </div>
            </header>
            {recommended.length > 0 && (
              <div className="fp-recommended">
                <h3>
                  {CATEGORY_LABELS.recommended} {recommended.length}点
                </h3>
                {recommended.map(pick)}
              </div>
            )}
            {optional.length > 0 && (
              <>
                <button
                  className="fp-expand optional"
                  type="button"
                  aria-expanded={Boolean(open[first.raceId])}
                  aria-controls={id}
                  onClick={() =>
                    setOpen({ ...open, [first.raceId]: !open[first.raceId] })
                  }
                >
                  {open[first.raceId]
                    ? "▲ 買ってもよいを閉じる"
                    : `▼ 買ってもよい${optional.length}点を表示`}
                </button>
                <div
                  id={id}
                  hidden={!open[first.raceId]}
                  className="fp-optional"
                >
                  {optional.map(pick)}
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
