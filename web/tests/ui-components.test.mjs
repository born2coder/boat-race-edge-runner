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
