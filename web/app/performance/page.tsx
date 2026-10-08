import Link from "next/link";
import {
  filtersFrom,
  selectEntries,
  aggregate,
  EV_BANDS,
  PROBABILITY_BANDS,
  TIME_BANDS,
  bandFor,
  timeBand,
  linkFilters,
} from "@/lib/four-page";
import {
  loadEntries,
  loadRules,
  loadModels,
  isolatedFixture,
} from "@/db/four-page-repository";
import { venueNames } from "@/lib/venues";
import {
  PageTitle,
  FiltersForm,
  ErrorPanel,
  EmptyState,
  SelectionNote,
  ProbabilityNote,
  number,
} from "@/components/four-page-common";
import {
  PerformanceKpis,
  ProfitChart,
  Breakdown,
} from "@/components/performance-summary";
export const dynamic = "force-dynamic";
export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  let f;
  try {
    f = filtersFrom(query);
  } catch (error) {
    return (
      <div className="fp-page">
        <PageTitle title="運用成績" subtitle="1点100円の仮想購入成績です。" />
        <ErrorPanel message={(error as Error).message} />
        <Link href="/performance" prefetch={false}>
          期間を選び直す
        </Link>
      </div>
    );
  }
  const [data, rules, models] = await Promise.all([
    loadEntries(f),
    loadRules(),
    loadModels(),
  ]);
  const entries = selectEntries(data.entries, f, venueNames),
    months = [...new Set(entries.map((e) => e.raceDate.slice(0, 7)))].sort();
  const compareRules = rules.slice(0, 6);
  if (
    !compareRules.some((r) => r.version === f.rule) &&
    rules.find((r) => r.version === f.rule)
  )
    compareRules.push(rules.find((r) => r.version === f.rule)!);
  const comparisons = await Promise.all(
    compareRules.map(async (rule) => {
      const cf = { ...f, rule: rule.version };
      const records = rule.version === f.rule ? data : await loadEntries(cf);
      const rows = selectEntries(records.entries, cf, venueNames);
      return { rule, rows, available: records.available, a: aggregate(rows) };
    }),
  );
  return (
    <div className="fp-page">
      <PageTitle
        title="運用成績"
        subtitle="1点100円の仮想購入成績です。実際の投票収支ではありません。"
        test={isolatedFixture()}
      />
      <FiltersForm f={f} rules={rules} models={models} />
      <SelectionNote f={f} rules={rules} />
      <ProbabilityNote />
      <ErrorPanel message={data.error} />
      <PerformanceKpis entries={entries} available={data.available} />
      {!entries.length && !data.error && <EmptyState />}
      {data.available && (
        <div className="fp-performance-grid">
          <ProfitChart entries={entries} />
          <Breakdown
            title="月別成績"
            f={f}
            rows={months.map((month) => ({
              label: month,
              entries: entries.filter((e) => e.raceDate.startsWith(month)),
              overrides: {
                period: "custom",
                from: month + "-01" > f.from ? month + "-01" : f.from,
                to:
                  new Date(
                    Date.UTC(
                      Number(month.slice(0, 4)),
                      Number(month.slice(5)),
                      0,
                    ),
                  )
                    .toISOString()
                    .slice(0, 10) < f.to
                    ? new Date(
                        Date.UTC(
                          Number(month.slice(0, 4)),
                          Number(month.slice(5)),
                          0,
                        ),
                      )
                        .toISOString()
                        .slice(0, 10)
                    : f.to,
              },
            }))}
          />
          <Breakdown
            title="期待回収率帯別"
            f={f}
            expected
            rows={EV_BANDS.filter(
              (b) => f.mode !== "recommended" || b.min >= 1.2,
            )
              .filter((b) => f.mode !== "optional" || b.max <= 1.2)
              .map((b) => ({
                label: b.label,
                entries: entries.filter(
                  (e) => bandFor(e.ev, EV_BANDS) === b.id,
                ),
                overrides: { evBand: b.id },
              }))}
          />
          <Breakdown
            title="保守確率帯別"
            f={f}
            probability
            rows={PROBABILITY_BANDS.map((b) => ({
              label: b.label,
              entries: entries.filter(
                (e) =>
                  bandFor(e.conservativeProbability, PROBABILITY_BANDS) ===
                  b.id,
              ),
              overrides: { probabilityBand: b.id },
            }))}
          />
          <details className="fp-card fp-all-venues">
            <summary>会場別（全24場）</summary>
            <Breakdown
              title="会場別成績"
              f={f}
              rows={Object.entries(venueNames).map(([code, name]) => ({
                label: name,
                entries: entries.filter((e) => e.venueCode === code),
                overrides: { venue: code },
              }))}
            />
          </details>
          <Breakdown
            title="仮想購入時の締切までの時間別"
            f={f}
            rows={TIME_BANDS.map((b) => ({
              label: b.label,
              entries: entries.filter(
                (e) => timeBand(e.minutesToClose) === b.id,
              ),
              overrides: { timeBand: b.id },
            }))}
          />
          <section className="fp-card fp-breakdown">
            <h2>予想・判定ルール版別</h2>
            <p className="fp-note">
              各版を独立して集計しています。選択期間 {f.from}〜{f.to}
              。版が多い場合は選択欄から個別に確認できます。
            </p>
            {comparisons.map((c) => (
              <div className="fp-version-row" key={c.rule.version}>
                <Link
                  href={linkFilters(f, { rule: c.rule.version })}
                  prefetch={false}
                >
                  {c.rule.version}
                </Link>
                <span>
                  記録期間{" "}
                  {c.rows.length
                    ? `${c.rows.map((e) => e.raceDate).sort()[0]}〜${c.rows
                        .map((e) => e.raceDate)
                        .sort()
                        .at(-1)}`
                    : "—"}
                </span>
                <span>適用開始 {c.rule.effectiveAt ?? "未運転"}</span>
                <span>
                  {c.available ? c.a.settled : "—"}点 ／ 的中率{" "}
                  {number(c.available ? c.a.hitRate : null, 2)}％ ／ 回収率{" "}
                  {number(c.available ? c.a.roi : null, 2)}％
                </span>
              </div>
            ))}
          </section>
        </div>
      )}
      <details className="fp-details">
        <summary>このページの計算と見方</summary>
        <p>
          主成績は的中・不的中が確定した買い目のみ。結果待ち・返還を除外し、購入額と払戻額の対象をそろえます。払戻は公式の100円当たり確定払戻
          × 購入額 ÷ 100です。
        </p>
        <p>
          最大連続不的中はレース単位。最大資金減少は初期0円からの累計収支の過去最高点との差。同時刻の精算をまとめて計算します。
        </p>
        <p>
          平均事前期待回収率・確率は仮想購入記録時の値です。保守確率は下側評価であり、的中率との一致を目標にしません。少数の記録だけで有効・無効を断定しません。
        </p>
        <Link href={linkFilters(f)} prefetch={false}>
          同じ条件の判断履歴を確認
        </Link>
      </details>
    </div>
  );
}
