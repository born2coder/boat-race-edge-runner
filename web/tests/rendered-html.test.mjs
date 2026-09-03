import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses finished Japanese metadata and removes the starter preview marker", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /BOAT RACE EDGE｜本日の厳選3連単予想/);
  assert.match(layout, /<html lang="ja">/);
  assert.doesNotMatch(layout, /codex-preview|Starter Project/);
});

test("public pages hide research and infrastructure details", async () => {
  const pages = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/about/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/stats/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/prediction/[predictionId]/page.tsx", import.meta.url), "utf8"),
  ]);
  const publicCopy = pages.join("\n");
  assert.doesNotMatch(publicCopy, /W_dynamic10_v1|publication hash|DBロック|PIPELINE|FROZEN HIT MODEL|Top5集中度/);
});

test("home restores understandable race-by-race picks and results", async () => {
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const card = await readFile(new URL("../components/prediction-card.tsx", import.meta.url), "utf8");
  const publicSurface = `${home}\n${card}`;

  assert.match(home, /前日の予想と結果/);
  assert.match(home, /予想したレース/);
  assert.match(home, /当たったレース/);
  assert.match(home, /使った金額/);
  assert.match(home, /戻ってきた金額/);
  assert.doesNotMatch(home, /これまでの検証成績/);
  assert.match(publicSurface, /出走メンバー/);
  assert.match(publicSurface, /3連単3点予想/);
  assert.match(publicSurface, /レース結果・収支/);
});
