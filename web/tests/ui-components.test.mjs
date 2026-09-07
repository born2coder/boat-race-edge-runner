import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the established BOAT RACE EDGE visual language", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /--lab-blue:/);
  assert.match(css, /--lab-teal:/);
  assert.match(css, /\.prediction-card/);
  assert.match(css, /@media \(max-width:/);
});

test("shows morning lock and exhibition badge states without changing tickets", async () => {
  const badge = await readFile(new URL("../components/reassessment-badge.tsx", import.meta.url), "utf8");
  const card = await readFile(new URL("../components/prediction-card.tsx", import.meta.url), "utf8");
  assert.match(badge, /展示評価待ち/);
  assert.match(badge, /展示判定なし/);
  assert.match(badge, /展示後信頼度上昇/);
  assert.match(badge, /展示後信頼度維持/);
  assert.match(badge, /展示後信頼度低下/);
  assert.match(card, /展示後も変更しません/);
});

test("normalizes historical examples to the displayed flat 100-yen Top3 rule", async () => {
  const data = await readFile(new URL("../lib/poc.ts", import.meta.url), "utf8");
  assert.match(data, /normalizeReplayPrediction/);
  assert.match(data, /stake_yen: 100/);
  assert.match(data, /virtual_stake_yen: stake/);
});

test("shows EDGE verification progress, 150 percent candidates, and history", async () => {
  const page = await readFile(new URL("../app/edge/page.tsx", import.meta.url), "utf8");
  const repository = await readFile(new URL("../db/live-repository.ts", import.meta.url), "utf8");
  assert.match(page, /確認済み/);
  assert.match(page, /未確認数もそのまま公開/);
  assert.match(page, /期待値150%以上/);
  assert.match(page, /いま買えるEDGE/);
  assert.match(page, /終了したレース・検証結果/);
  assert.match(page, /groupByRace/);
  assert.match(page, /結果確認中/);
  assert.match(page, /レース・.*点/);
  assert.match(page, /sortByStart/);
  assert.match(page, /liveGroups/);
  assert.match(page, /edge-history-row/);
  assert.match(repository, /expected_value_percent: "gte\.150"/);
  assert.match(repository, /edge_shadow\/index\.json/);
  assert.match(repository, /getOfficialResult/);
  assert.match(repository, /pendingRaceIds/);
  assert.match(repository, /candidate\.race_date < date \|\| candidate\.status === "settled"/);
});
