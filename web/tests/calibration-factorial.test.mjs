import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
const require = createRequire(import.meta.url);
async function load(path, mocks = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  }}).outputText;
  const result = {};
  new Function("exports", "require", js)(result, name =>
    Object.hasOwn(mocks, name) ? mocks[name] :
      name === "server-only" || name.startsWith("@/db/") || name.endsWith(".css") ? {} : require(name));
  return result;
}
const { calibrationSchema } = await load("../db/calibration-repository.ts");
const { FactorialComparison, MarketComparison, StrategyComparison } = await load("../app/calibration/strategy-comparison.tsx");
const policy = {tickets: 10, hits: 1, stake: 1000, payout: 800, roi: .8,
  supportedTickets: 120, unsupportedTickets: 0, evaluatedRaces: 1};
const legacy = {baseline: policy, probability: policy, adjusted: policy};
const factorial = {raw080: policy, raw100: {...policy, tickets: 20, stake: 2000, payout: 2000, roi: 1},
  calibrated080: policy, calibrated100: policy};
const phase = {trainRaces: 100, testRaces: 100, finalGridTrainRaces: 100, finalGridTestRaces: 100,
  temperature: 1, status: "collecting", probabilityPass: false, oddsPass: false,
  rawProbability: null, adjustedProbability: null,
  oddsValidation: {races: 0, tickets: 0, rawLogError: null, adjustedLogError: null, belowLowerRate: null},
  policyComparison: legacy};
const report = {version: "edge-calibration-v2", asOf: "2026-10-30", artifactId: "test", modelSha: "model-a",
  mode: "shadow", trainDates: [], testDates: [], minTrainDays: 7, minTestDays: 3, minRaces: 100,
  phases: {t10: phase}};
test("legacy reports remain readable without inventing four-arm results", () => {
  for (const version of ["edge-calibration-v1", "edge-calibration-v2"]) {
    const parsed = calibrationSchema.parse({...report, version});
    assert.equal(parsed.factorialForwardComparison, undefined);
  }
  const html = renderToStaticMarkup(createElement(StrategyComparison, {data: legacy, title: "従来"}));
  assert.ok(html.includes("係数なし"));
  assert.ok(!html.includes("A 元確率"));
});
test("v3 keeps independent forward and historical four-arm results and rejects incomplete arms", () => {
  const group = {all: factorial, under20: factorial};
  const value = {...report, version: "edge-calibration-v3", factorialExperimentId: "calibration-factorial-20261031-v1",
    phases: {t10: {...phase, factorialComparison: group}},
    factorialForwardComparison: {t10: {...group, recordedRaces: 1}}};
  const parsed = calibrationSchema.parse(value);
  assert.equal(parsed.factorialForwardComparison.t10.all.raw100.tickets, 20);
  const broken = structuredClone(value);
  delete broken.factorialForwardComparison.t10.all.calibrated080;
  assert.equal(calibrationSchema.safeParse(broken).success, false);
});
test("four-way display separates coefficient and probability contrasts with spending changes", () => {
  const html = renderToStaticMarkup(createElement(FactorialComparison, {data: factorial, title: "比較"}));
  for (const label of ["A 元確率", "B 元確率", "C 補正確率", "D 補正確率", "A → C", "B → D", "A → B", "C → D"])
    assert.ok(html.includes(label), label);
  assert.ok(html.includes("+20.00ポイント"));
  assert.ok(html.includes("購入点数の差"));
  assert.ok(html.includes("収支の差"));
});
test("unsupported results display unavailable rather than a zero-return performance", () => {
  const noData = Object.fromEntries(Object.keys(factorial).map(k => [k, {...policy, tickets: 0, hits: 0,
    stake: 0, payout: 0, roi: null, supportedTickets: 0}]));
  const html = renderToStaticMarkup(createElement(FactorialComparison, {data: noData, title: "未評価"}));
  assert.ok(html.includes("比較に必要なデータがまだありません"));
  assert.ok(!html.includes("0.00％"));
});
const market = {marketBaseline: policy, oddsUnder20: {...policy, tickets: 5, stake: 500, roi: 1.6},
  gapUnder3: policy, under20Gap3: policy, blend50: policy};
test("market v4 retains five arms and older reports without inventing market results", () => {
  const value = {...report, version: "edge-calibration-v4", marketExperimentId: "market-strategy-20261031-v1",
    phases: {t10: {...phase, marketComparison: market}},
    marketForwardComparison: {t10: {policies: market, recordedRaces: 1}}};
  const parsed = calibrationSchema.parse(value);
  assert.equal(parsed.marketForwardComparison.t10.policies.oddsUnder20.tickets, 5);
  const broken = structuredClone(value);
  delete broken.marketForwardComparison.t10.policies.blend50;
  assert.equal(calibrationSchema.safeParse(broken).success, false);
  for (const version of ["edge-calibration-v1", "edge-calibration-v2", "edge-calibration-v3"]) {
    assert.equal(calibrationSchema.parse({...report, version}).marketForwardComparison, undefined);
  }
});
test("market comparison shows spending and profit changes alongside return", () => {
  const html = renderToStaticMarkup(createElement(MarketComparison, {data: market, title: "市場比較"}));
  for (const label of ["現行方式（比較基準）", "20倍未満＋乖離3倍未満", "モデルと市場を半分ずつ",
    "+80.00ポイント", "-5点", "購入点数の差", "収支の差"])
    assert.ok(html.includes(label), label);
  const empty = Object.fromEntries(Object.keys(market).map(key => [key, {...policy,
    tickets: 0, hits: 0, stake: 0, payout: 0, roi: null, supportedTickets: 0}]));
  const waiting = renderToStaticMarkup(createElement(MarketComparison, {data: empty, title: "集計待ち"}));
  assert.ok(waiting.includes("比較に必要なデータがまだありません"));
  assert.ok(!waiting.includes("0.00％"));
});
test("market page distinguishes frozen future decisions from selection-biased historical trials", async () => {
  let current = {...report};
  const page = await load("../app/calibration/page.tsx", {
    "@/db/calibration-repository": {loadCalibration: async () => current},
    "@/components/four-page-common": {PageTitle: ({title}) => createElement("h1", null, title)},
    "@/lib/four-page": {jstDate: () => "2026-10-31"},
    "./strategy-comparison": {FactorialComparison, MarketComparison, StrategyComparison},
  });
  const waiting = renderToStaticMarkup(await page.default());
  assert.ok(waiting.includes("市場比較の新しい購入条件は、まだ集計されていません"));
  current = {...current, version: "edge-calibration-v4", marketExperimentId: "market-strategy-20261031-v1",
    phases: {t10: {...phase, marketComparison: market}},
    marketForwardComparison: {t10: {policies: market, recordedRaces: 1}}};
  const ready = renderToStaticMarkup(await page.default());
  for (const label of ["新しい購入条件を固定した後の成績", "過去データでの参考試算", "この試算だけでは有効性を判定できません",
    "市場比較：ルール固定後の成績", "市場比較：過去の参考試算", "3倍ちょうど、20倍ちょうど"])
    assert.ok(ready.includes(label), label);
});
test("page labels old-report waiting, historical trials and newly recorded results separately", async () => {
  const page = await load("../app/calibration/page.tsx", {
    "@/db/calibration-repository": {loadCalibration: async () => report},
    "@/components/four-page-common": {PageTitle: ({title}) => createElement("h1", null, title)},
    "@/lib/four-page": {jstDate: () => "2026-10-31"},
    "./strategy-comparison": {FactorialComparison, StrategyComparison},
  });
  const waiting = renderToStaticMarkup(await page.default());
  assert.ok(waiting.includes("4方式の集計はまだありません"));
  assert.ok(waiting.includes("同じ観測オッズ"));
  report.factorialExperimentId = "calibration-factorial-20261031-v1";
  report.factorialForwardComparison = {t10: {recordedRaces: 0, all: factorial, under20: factorial}};
  report.phases.t10.factorialComparison = {all: factorial, under20: factorial};
  const ready = renderToStaticMarkup(await page.default());
  assert.ok(ready.includes("実装後に締切前の判断を保存した成績"));
  assert.ok(ready.includes("過去データでの試算"));
  assert.ok(!ready.includes("4方式の集計はまだありません"));
});
