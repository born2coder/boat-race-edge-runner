import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { policy as p } from "./four-page/load-policy.mjs";
const entry = (raceId, closeAt, patch = {}) => ({
  id: raceId, raceId, closeAt, raceDate: "2026-10-09", venueCode: "20", raceNo: 11,
  combination: "1-2-3", category: "recommended", outcome: "pending", stakeYen: 100,
  payoutYen: null, probability: .05, conservativeProbability: .04, calibratedProbability: null,
  odds: 40, ev: 1.6, minutesToClose: 10, finalOdds: null, events: [], ...patch,
});
test("history orders deadlines descending across venues and dates; unknown deadlines last", () => {
  const rows = [entry("early", "2026-10-09T18:00:00+09:00"),
    entry("late", "2026-10-09T22:54:00+09:00"), entry("unknown", null),
    entry("yesterday", "2026-10-08T23:00:00+09:00"), entry("invalid", "bad")];
  assert.deepEqual(p.historyRaces(rows).map(r => r[0].raceId), ["late", "early", "yesterday", "unknown", "invalid"]);
  assert.equal(rows[0].raceId, "early");
});
test("history sorts before pagination and after loading details", async () => {
  const page = await readFile(new URL("../app/signal-log/page.tsx", import.meta.url), "utf8");
  assert.match(page, /groups = historyRaces\(selected\)/);
  assert.match(page, /detailed = historyRaces\(entries\)/);
});
const require = createRequire(import.meta.url), exports = {};
const code = ts.transpileModule(await readFile(new URL("../components/history-races.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new Function("exports", "require", code)(exports, name => ({
  "@/lib/four-page": p, "@/lib/venues": { venueNames: { "20": "若松" } },
  "@/components/four-page-common": { ...Object.fromEntries(["evText", "percent", "stamp", "yen", "signedYen"].map(k => [k, String])), outcomeLabels: { pending: "結果待ち" } },
}[name] ?? require(name)));
for (const count of [1, 4, 8]) test(`all ${count} picks are inside one initially closed disclosure`, () => {
  const rows = Array.from({ length: count }, (_, i) => entry("BR:20261009:20:11", "2026-10-09T22:30:00+09:00", { id: String(i) }));
  const $ = load(renderToStaticMarkup(React.createElement(exports.HistoryRaces, { groups: [rows] })));
  const disclosure = $("section > details");
  assert.equal(disclosure.length, 1);
  assert.equal(disclosure.attr("open"), undefined);
  assert.equal(disclosure.find("article").length, count);
  assert.equal($("article[hidden]").length, 0);
  assert.match(disclosure.children("summary").text(), new RegExp(`全${count}点`));
  assert.match($("section > header").text(), /締切/);
  assert.doesNotMatch($("section > header").text(), /1-2-3/);
});
