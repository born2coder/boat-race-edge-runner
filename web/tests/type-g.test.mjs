import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/hit-type-g/page.tsx", import.meta.url), "utf8");
const ledger = fs.readFileSync(new URL("../app/hit-type-g/type-g-ledger.tsx", import.meta.url), "utf8");
const repository = fs.readFileSync(new URL("../db/live-repository.ts", import.meta.url), "utf8");
const ingest = fs.readFileSync(new URL("../db/ingest-repository.ts", import.meta.url), "utf8");

test("type-G page leads with live races and separates completed results", () => {
  assert.match(page, /これからのtype-G予想/);
  assert.match(page, /終了したレース・検証結果/);
  assert.ok(page.indexOf("これからのtype-G予想") < page.indexOf("終了したレース・検証結果"));
});

test("type-G page shows same-point comparison and requested settlement totals", () => {
  assert.match(page, /購入点数/);
  assert.match(page, /的中払戻合計/);
  assert.match(page, /検証回収率/);
  assert.match(page, /Top1/);
  assert.match(page, /Top8/);
});

test("type-G ledger can filter changed picks and hits", () => {
  assert.match(ledger, /買い目変更/);
  assert.match(ledger, /的中のみ/);
  assert.match(ledger, /現行HIT/);
});

test("type-G records stay outside official HIT statistics", () => {
  assert.match(repository, /type_g_shadow_v1/);
  assert.match(repository, /readOfficialPredictions/);
  assert.doesNotMatch(repository.match(/async function readOfficialPredictions[\s\S]*?return Array\.from\(preferred\.values\(\)\);/)?.[0] ?? "", /type_g_shadow_v1/);
  assert.match(ingest, /payload\.stream === "official"/);
});
