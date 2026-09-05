import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = {};
  new Function("exports", "require", code)(result, require);
  return result;
}
const { racePhase, officialResultUrl } = await loadTs("../lib/race-lifecycle.ts");
const { parseOfficialResult } = await loadTs("../lib/official-result-parser.ts");
const id = "BR:20260905:11:01";
const observed = "2026-09-05T02:30:00Z";
const roster = [5246, 5177, 5238, 5421, 5290, 5388].map((racer_id, i) => ({ lane_no: i + 1, racer_id: String(racer_id) }));
const order = [1, 3, 6, 2, 5, 4];
function sample({ refund = "", extraPayout = "", combination = [1, 3, 6], code = "", date = "20260905" } = {}) {
  return `<table><thead><tr><th><a href="/owpc/pc/race/raceresult?rno=1&jcd=11&hd=${date}">1R</a></th><th class="is-thColor2"><a href="/owpc/pc/race/raceresult?rno=2&jcd=11&hd=${date}">2R</a></th></tr></thead></table>
  <table><thead><tr><th>着</th><th>枠</th><th>ボートレーサー</th><th>レースタイム</th></tr></thead>${order.map((lane, i) => `<tbody><tr><td>${i === 5 && code ? code : String.fromCharCode(0xff11 + i)}</td><td>${lane}</td><td><span class="is-fs12">${roster[lane - 1].racer_id}</span></td></tr></tbody>`).join("")}</table>
  <table><thead><tr><th>払戻</th></tr></thead><tbody><tr><td>3連単</td><td>${combination.map((n) => `<span class="numberSet1_number">${n}</span>`).join("")}</td><td><span class="is-payout1">&yen;1,990</span></td></tr><tr><td></td><td><span class="is-payout1">${extraPayout}</span></td></tr></tbody></table>
  <table><thead><tr><th>返還</th></tr></thead><tbody><tr><td>${refund}</td></tr></tbody></table>`;
}

test("deadline equality moves race out of upcoming, even when result fetch is delayed", () => {
  const p = { race: { start_at: "2026-09-05T10:33:00+09:00" }, result: null };
  const deadline = Date.parse(p.race.start_at);
  assert.equal(racePhase(p, deadline - 1), "upcoming");
  assert.equal(racePhase(p, deadline), "pending");
  assert.equal(racePhase(p, deadline + 3600000), "pending");
  assert.equal(racePhase({ ...p, result: {} }, deadline), "settled");
  assert.equal(racePhase({ race: { start_at: "invalid" }, result: null }), "pending");
});

test("official URL cannot be redirected by an arbitrary race identifier", () => {
  assert.equal(officialResultUrl(id), "https://www.boatrace.jp/owpc/pc/race/raceresult?hd=20260905&jcd=11&rno=1");
  for (const bad of ["https://evil.test", "BR:20260905:99:01", "BR:20260905:11:00", "BR:20260905:11:13"]) assert.equal(officialResultUrl(bad), null);
});

test("normal official result matches all six registered racers and trifecta payout", () => {
  const r = parseOfficialResult(sample(), id, roster, observed);
  assert.equal(r.combination, "1-3-6");
  assert.equal(r.payout_per_100_yen, 1990);
  assert.deepEqual(r.finishers.map((f) => f.lane_no), order);
  assert.equal(r.observed_at, observed);
});

test("no fabricated settlement on missing, wrong-date, wrong-race, or wrong-roster pages", () => {
  for (const html of ["", "<h1>レース中止</h1>", sample({ date: "20260904" }), sample().replace("5246", "9999")]) {
    assert.equal(parseOfficialResult(html, id, roster, observed), null);
  }
  assert.equal(parseOfficialResult(sample(), "BR:20260905:11:02", roster, observed), null);
  assert.equal(parseOfficialResult(sample(), id, roster.slice(1), observed), null);
});

test("refunds, dead heats, disqualifications and mismatched payouts remain pending", () => {
  for (const args of [{ refund: "2" }, { extraPayout: "¥1,000" }, { code: "Ｆ" }, { code: "転" }, { combination: [1, 2, 3] }]) {
    assert.equal(parseOfficialResult(sample(args), id, roster, observed), null);
  }
  assert.equal(parseOfficialResult(sample().replace("６</td>", "５</td>"), id, roster, observed), null);
});

test("result recovery never alters predictions, is bounded, and writes insert-only", async () => {
  const service = await readFile(new URL("../db/official-results.ts", import.meta.url), "utf8");
  const reader = await readFile(new URL("../db/live-repository.ts", import.meta.url), "utf8");
  assert.match(service, /resolution=ignore-duplicates/);
  assert.match(service, /revalidate: 60/);
  assert.match(service, /AbortSignal.timeout\(5000\)/);
  assert.doesNotMatch(service, /supabaseRequest\("predictions/);
  assert.match(reader, /slice\(0, 20\)/);
  assert.match(reader, /age >= 0/);
});

test("UI separates closed races and displays original tickets next to actual result", async () => {
  const today = await readFile(new URL("../components/today-races.tsx", import.meta.url), "utf8");
  const badge = await readFile(new URL("../components/reassessment-badge.tsx", import.meta.url), "utf8");
  const refresh = await readFile(new URL("../components/live-refresh.tsx", import.meta.url), "utf8");
  assert.match(today, /racePhase\(p, now\) === "upcoming"/);
  assert.match(today, /racePhase\(p, now\) !== "upcoming"/);
  assert.match(today, /事前に公開した3点/);
  assert.match(today, /実際の結果/);
  assert.match(today, /結果確認中/);
  assert.match(badge, /cutoffReached \? "展示判定なし"/);
  assert.match(refresh, /setInterval\(refresh, 60_000\)/);
  assert.match(refresh, /visibilityState === "visible"/);
  assert.match(refresh, /clearInterval/);
});

test("rendered daily board keeps Biwako's miss out of upcoming and preserves the original three tickets", async () => {
  const source = await readFile(new URL("../components/today-races.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  const mappedRequire = (name) => {
    if (name === "@/lib/race-lifecycle") return { racePhase, officialResultUrl };
    if (name === "@/lib/poc") return { formatYen: (value) => `${value.toLocaleString("ja-JP")}円` };
    if (name === "@/components/reassessment-badge") return { ReassessmentBadge: () => React.createElement("span", null, "展示評価待ち") };
    if (name === "next/link") return { __esModule: true, default: ({ prefetch, ...props }) => React.createElement("a", props) };
    return require(name);
  };
  new Function("exports", "require", code)(exports, mappedRequire);
  const tickets = ["1-3-2", "1-2-3", "3-1-2"].map((combination) => ({ combination, stake_yen: 100 }));
  const p = { prediction_id: "biwako", race_id: id, tickets, race: { venue: "びわこ", race_no: 1, start_at: "2026-09-05T10:33:00+09:00", start_time_jst: "10:33", entries: roster.map((r) => ({ ...r, racer_name: `選手${r.lane_no}` })) }, result: { ...parseOfficialResult(sample(), id, roster, observed), settlement: { hit: false, original_stake_yen: 300, gross_return_yen: 0, profit_yen: -300 } } };
  const later = { ...p, prediction_id: "later", race: { ...p.race, venue: "蒲郡", start_at: "2026-09-05T20:10:00+09:00" }, result: null };
  const pending = { ...p, prediction_id: "pending", race: { ...p.race, venue: "確認場" }, result: null };
  const html = renderToStaticMarkup(React.createElement(exports.TodayRaces, { predictions: [p, later, pending], now: Date.parse(observed) }));
  const [upcoming, closed] = html.split('id="today-results"');
  assert.match(upcoming, /蒲郡/);
  assert.doesNotMatch(upcoming, /びわこ|確認場/);
  assert.match(closed, /びわこ/);
  assert.match(closed, /不的中/);
  assert.match(closed, /1-3-6/);
  assert.match(closed, /結果確認中/);
  assert.doesNotMatch(closed, /展示評価待ち/);
  for (const ticket of tickets) assert.ok(closed.includes(ticket.combination));
  assert.match(closed, /-300円/);
});
