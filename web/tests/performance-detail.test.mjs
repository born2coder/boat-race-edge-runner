import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

let source = (await readFile(new URL("../db/live-repository.ts", import.meta.url), "utf8")).replace(/^import .*;$/gm, "");
source += "\nexport { summarizePeriod };";
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildPerformanceDetail, summarizePeriod } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
function prediction(date, returned, eligible = true) {
  return { official_performance_eligible: eligible, race: { race_date: date, start_at: `${date}T10:00:00+09:00` }, result: returned === null ? null : { settlement: { hit: returned > 0, counted_stake_yen: 300, gross_return_yen: returned } } };
}
const rows = [prediction("2026-08-30", 900), prediction("2026-08-31", 0), prediction("2026-09-01", 1200), prediction("2026-09-01", 0), prediction("2026-09-05", 600), prediction("2026-09-05", null), prediction("2026-09-05", 9900, false), prediction("2026-09-06", 2000)];

test("daily ledger reconciles exactly to homepage summary, with pending and excluded records omitted from money", () => {
  const detail = buildPerformanceDetail(rows, "2026-09-05", "month");
  const summary = summarizePeriod(rows, { key: "month", label: "今月", startDate: "2026-09-01", endDate: "2026-09-05" });
  for (const key of ["settled", "hits", "hitRate", "stake", "returned", "returnRate"]) assert.equal(detail[key], summary[key]);
  assert.equal(detail.published, 4);
  assert.equal(detail.pending, 1);
  assert.equal(detail.stake, 900);
  assert.equal(detail.returned, 1800);
  assert.equal(detail.returnRate, 200);
  assert.deepEqual(detail.days.map(d => d.date), ["2026-09-05", "2026-09-01"]);
  assert.deepEqual(detail.days.map(d => d.cumulativeProfit), [900, 600]);
  assert.equal(detail.days.reduce((sum, d) => sum + d.stake, 0), detail.stake);
  assert.equal(detail.days.reduce((sum, d) => sum + d.returned, 0), detail.returned);
});

test("Monday-based weeks and year boundaries select the intended records", () => {
  const week = buildPerformanceDetail(rows, "2026-09-05", "week");
  assert.equal(week.startDate, "2026-08-31");
  assert.equal(week.settled, 4);
  assert.equal(week.days[0].cumulativeProfit, 600);
  const year = buildPerformanceDetail(rows, "2026-09-05", "year");
  assert.equal(year.startDate, "2026-01-01");
  assert.equal(year.settled, 5);
  const crossing = buildPerformanceDetail([prediction("2026-12-31", 900), prediction("2027-01-01", 0)], "2027-01-02", "year");
  assert.equal(crossing.settled, 1);
  assert.equal(crossing.returned, 0);
});

test("empty and entirely pending days retain null rates and zero settled stake", () => {
  for (const items of [[], [prediction("2026-09-05", null)]]) {
    const detail = buildPerformanceDetail(items, "2026-09-05", "month");
    assert.equal(detail.hitRate, null);
    assert.equal(detail.returnRate, null);
    assert.equal(detail.stake, 0);
    assert.equal(detail.returned, 0);
    assert.equal(detail.pending, items.length);
  }
});
