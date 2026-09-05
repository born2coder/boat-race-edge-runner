import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("late publication is preserved but excluded from official performance", async () => {
  const ts = (await import("typescript")).default;
  let source = await readFile(new URL("../db/live-repository.ts", import.meta.url), "utf8");
  source = source.replace(/^import .*;$/gm, "");
  source += "\nexport { hydratePrediction, summarizePeriod };";
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { hydratePrediction, summarizePeriod } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const row = {
    race_id: "test", published_at: "2026-09-05T08:48:00+09:00", official_performance_eligible: true,
    race: { race_id: "test", race_date: "2026-09-05", start_at: "2026-09-05T08:32:00+09:00", entries: [],
      result: { combination: "1-2-3", payout_per_100_yen: 1200, finishers: [] } },
    tickets: ["1-2-3", "1-3-2", "1-2-4"].map((combination) => ({ combination, stake_yen: 100 })),
  };
  const late = hydratePrediction(row);
  assert.equal(late.official_performance_eligible, false);
  assert.equal(late.result.settlement.gross_return_yen, 1200);
  assert.equal(late.published_at, row.published_at);
  assert.deepEqual(late.tickets, row.tickets);
  const onTime = hydratePrediction({ ...row, published_at: "2026-09-05T08:00:00+09:00" });
  assert.equal(onTime.official_performance_eligible, true);
  for (const published_at of [row.race.start_at, "invalid"]) {
    assert.equal(hydratePrediction({ ...row, published_at }).official_performance_eligible, false);
  }
  const summary = summarizePeriod([late, onTime], { key: "week", label: "今週", startDate: "2026-09-01", endDate: "2026-09-05" });
  assert.equal(summary.settled, 1);
  assert.equal(summary.hits, 1);
  assert.equal(summary.stake, 300);
});

test("prediction reads join results through races rather than a nonexistent direct relationship", async () => {
  const reader = await readFile(new URL("../db/live-repository.ts", import.meta.url), "utf8");
  assert.match(reader, /race:races!inner\(\*,result:results\(\*\)\)/);
  assert.match(reader, /const resultRow = one\(raceRow\.result\)/);
  assert.doesNotMatch(reader, /race:races!inner\(\*\),result:results/);
});

test("scheduled runner keeps credentials out of source and syncs two service days", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/results.yml", import.meta.url), "utf8");
  assert.match(workflow, /secrets\.EDGE_SITE_INGEST_ENDPOINT/);
  assert.match(workflow, /secrets\.EDGE_SITE_INGEST_SECRET/);
  assert.match(workflow, /date -d yesterday/);
  assert.match(workflow, /--no-legacy-predictions/);
  assert.doesNotMatch(workflow, /x-edge-signature:\s*[a-f0-9]{64}/i);
});

test("ingest endpoint verifies timestamp, nonce and HMAC before accepting data", async () => {
  const route = await readFile(new URL("../app/api/internal/ingest/route.ts", import.meta.url), "utf8");
  assert.match(route, /MAX_CLOCK_SKEW_SECONDS = 300/);
  assert.match(route, /claimIngestionNonce/);
  assert.match(route, /HMAC/);
  assert.match(route, /safeParse/);
});

test("ingest contract accepts fixed morning Top8 ranking, Top3 stake, and exhibition reassessment", async () => {
  const schema = await readFile(new URL("../lib/ingest-schema.ts", import.meta.url), "utf8");
  assert.match(schema, /W_morning_badge_v1/);
  assert.match(schema, /morning-top3-flat100-v1/);
  assert.match(schema, /reassessmentSchema/);
  assert.match(schema, /exhibition-support-v1/);
  assert.match(schema, /tickets\.length !== 8/);
  assert.match(schema, /virtual_stake_yen !== 300/);
});

test("morning forward records are capped at ten and settle only the first three", async () => {
  const repository = await readFile(new URL("../db/ingest-repository.ts", import.meta.url), "utf8");
  const reader = await readFile(new URL("../db/live-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /morning_fixed_hit_v1/);
  assert.match(repository, /prediction_reassessments/);
  assert.match(reader, /tickets\.slice\(0, 3\)/);
  assert.match(reader, /morning_fixed_hit_v1/);
  assert.match(repository, /official_performance_eligible: prediction\.official_performance_eligible/);
});

test("Vercel build is free of the previous Cloudflare runtime", async () => {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/internal/ingest/route.ts", import.meta.url), "utf8");
  assert.match(packageJson, /"build": "next build"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|@cloudflare/);
  assert.doesNotMatch(route, /cloudflare:workers/);
});

test("Supabase public reads use RLS while writes remain server-only", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260903_initial.sql", import.meta.url), "utf8");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /Public can read predictions/);
  assert.match(migration, /revoke all on public\.ingestion_runs, public\.ingestion_nonces/);
});

test("exhibition badges are stored separately from immutable morning predictions", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260904_morning_reassessments.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists public\.prediction_reassessments/);
  assert.match(migration, /prediction_id text primary key references public\.predictions/);
  assert.match(migration, /status in \('supported', 'confirmed', 'cautious'\)/);
});

test("prediction surface hides internal inputs and model details", async () => {
  const detail = await readFile(new URL("../app/prediction/[predictionId]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /3連単3点予想/);
  assert.doesNotMatch(detail, /W_dynamic10_v1|Top5集中度|予想ロジック版|publication hash/);
});

test("public results use only published predictions and expose period hit rates", async () => {
  const repository = await readFile(new URL("../db/live-repository.ts", import.meta.url), "utf8");
  const stats = await readFile(new URL("../app/stats/page.tsx", import.meta.url), "utf8");
  assert.match(repository, /getYesterdayResultDay/);
  assert.match(repository, /getPerformancePeriods/);
  assert.match(repository, /return \[\];/);
  assert.doesNotMatch(repository, /source: "historical_sample"/);
  assert.match(stats, /日別の内訳/);
  assert.match(stats, /集計期間を選ぶ/);
  assert.doesNotMatch(stats, /過去データでの検証結果/);
});
