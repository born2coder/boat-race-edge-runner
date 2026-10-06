import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/performance/page.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

async function render(query) {
  const days = [];
  const exports = {};
  const strategies = [{ strategy_version: "research-v1" }];
  new Function("exports", "require", code)(exports, name => {
    if (name === "@/db/edge-v2-repository") return {
      validDate: value => /^20\d{2}-\d{2}-\d{2}$/.test(value),
      getEdgeV2Index: () => { throw new Error("Whole-history index must not be read"); },
      getEdgeV2Day: async date => { days.push(date); return { date, races: {} }; },
    };
    if (name === "@/db/research-repository") return {
      getForwardSignals: async () => [], getForwardBuySnapshots: async () => [],
    };
    if (name === "@/db/research-strategies") return {
      activeResearchStrategy: async () => strategies[0], researchStrategies: async () => strategies,
    };
    if (name === "@/lib/poc") return { venueNames: {} };
    if (name === "@/lib/research-terminal") return {
      daySignals: () => [], forwardPerformance: () => ({ buys: 0, settled: 0, hits: 0, stake: 0, payout: 0, roi: null }),
    };
    if (name === "next/link") return { __esModule: true,
      default: props => { const linkProps = { ...props }; delete linkProps.prefetch; return React.createElement("a", linkProps); } };
    return require(name);
  });
  const html = renderToStaticMarkup(await exports.default({ searchParams: Promise.resolve(query) }));
  return { days, html };
}

test("performance navigation reads no raw historical day", async () => {
  const { days, html } = await render({});
  assert.deepEqual(days, []);
  assert.match(html, /1日分を確認/);
  assert.match(html, /SHADOW FORWARD/);
  assert.doesNotMatch(html, /BACKTEST · BUY時EV帯/);
});

test("explicit backtest selection reads exactly one day and preserves forward display", async () => {
  const { days, html } = await render({ backtest_date: "2026-09-30", strategy_version: "research-v1" });
  assert.deepEqual(days, ["2026-09-30"]);
  assert.match(html, /2026-09-30 · 既存観測の再計算/);
  assert.match(html, /BACKTEST · BUY時EV帯/);
  assert.match(html, /SHADOW FORWARD/);
});

test("invalid backtest input cannot start a historical read", async () => {
  assert.deepEqual((await render({ backtest_date: "all" })).days, []);
});
