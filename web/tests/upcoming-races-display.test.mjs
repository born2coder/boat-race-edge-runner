import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { policy } from "./four-page/load-policy.mjs";
const require = createRequire(import.meta.url);
const code = ts.transpileModule(await readFile(new URL("../components/upcoming-races.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
new Function("exports", "require", code)(exports, name => ({
  "@/lib/four-page": policy,
  "@/lib/venues": { venueNames: { "20": "若松" } },
  "@/components/four-page-common": Object.fromEntries(["evText", "percent", "stamp", "oddsText"].map(k => [k, String])),
}[name] ?? require(name)));
const now = Date.parse("2026-10-09T13:20:00Z");
const observation = {
  raceId: "BR:20261009:20:11", combination: "1-2-3",
  closeAt: new Date(now + 600000).toISOString(), observedAt: new Date(now - 1000).toISOString(),
  receivedAt: new Date(now).toISOString(), generatedAt: new Date(now - 2000).toISOString(),
  probability: .05, conservativeProbability: .04, calibratedProbability: null, odds: 40,
  officialCloseVerified: true, cancelled: false, resultKnown: false,
  modelVersion: policy.MODEL_VERSION, ruleVersion: policy.RULE_VERSION,
};
const render = (observations, extra = {}) => renderToStaticMarkup(React.createElement(exports.UpcomingRaces, {
  observations, stopped: false, error: null, initialNow: now, ...extra,
}));
test("fresh valid midnight picks render immediately without waiting for hydration", () => {
  const html = render([observation]);
  assert.match(html, /1-2-3/);
  assert.match(html, /若松/);
  assert.doesNotMatch(html, /条件を満たすデータがありません/);
});
test("no picks, invalid, expired, stale and stopped states use the requested empty copy", () => {
  for (const [rows, extra] of [
    [[], {}], [[{ ...observation, probability: null }], {}],
    [[{ ...observation, closeAt: new Date(now).toISOString() }], {}],
    [[{ ...observation, observedAt: new Date(now - 300001).toISOString() }], {}],
    [[observation], { stopped: true }],
  ]) {
    const html = render(rows, extra);
    assert.match(html, /条件を満たすデータがありません。/);
    assert.doesNotMatch(html, /1-2-3|取得停止中|データ確認中/);
  }
});
test("read errors remain separate from an empty successful result", () => {
  assert.equal(render([], { error: "読み込み失敗", stopped: true }), "");
});
