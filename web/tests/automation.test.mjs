import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("ingest contract accepts only the frozen model's fixed Top8 and Top3 stake", async () => {
  const schema = await readFile(new URL("../lib/ingest-schema.ts", import.meta.url), "utf8");
  assert.match(schema, /W_dynamic10_v1/);
  assert.match(schema, /top3-flat100-v1/);
  assert.match(schema, /tickets\.length !== 8/);
  assert.match(schema, /virtual_stake_yen !== 300/);
});

test("frozen forward records are capped at ten and settle only the first three", async () => {
  const repository = await readFile(new URL("../db/ingest-repository.ts", import.meta.url), "utf8");
  const reader = await readFile(new URL("../db/live-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /frozen_forward_hit_v1" \? 10 : 3/);
  assert.match(reader, /tickets\.slice\(0, 3\)/);
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

test("prediction surface hides internal inputs and model details", async () => {
  const detail = await readFile(new URL("../app/prediction/[predictionId]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /3連単3点予想/);
  assert.doesNotMatch(detail, /W_dynamic10_v1|Top5集中度|予想ロジック版|publication hash/);
});
