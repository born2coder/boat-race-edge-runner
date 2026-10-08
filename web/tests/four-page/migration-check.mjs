const { PGlite } = await import(
  process.env.FOUR_PAGE_PGLITE_MODULE ?? "@electric-sql/pglite"
);
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { policy as p } from "./load-policy.mjs";
const db = new PGlite();
const web = new URL("../../", import.meta.url);
await db.exec(
  "create role anon; create role authenticated; create role service_role bypassrls; create table public.races(race_id text primary key);",
);
for (const file of [
  "20260928_research_terminal_draft.sql",
  "20260928_research_refunds.sql",
  "20261007163631_four_page_research.sql",
])
  await db.exec(
    await readFile(new URL("supabase/migrations/" + file, web), "utf8"),
  );
const now = Date.now() - 60000,
  iso = (t) => new Date(t).toISOString(),
  date = p.jstDate(now),
  raceId = `BR:${date.replaceAll("-", "")}:07:10`;
const obs = {
  raceId,
  combination: "1-2-3",
  closeAt: iso(now + 1000000),
  observedAt: iso(now - 1000),
  receivedAt: iso(now),
  generatedAt: null,
  probability: 0.05,
  calibratedProbability: null,
  conservativeProbability: 0.04,
  odds: 27.5,
  officialCloseVerified: true,
  cancelled: false,
  resultKnown: false,
  modelVersion: p.MODEL_VERSION,
  ruleVersion: p.RULE_VERSION,
};
const combos = [];
for (let a = 1; a <= 6; a++)
  for (let b = 1; b <= 6; b++)
    for (let c = 1; c <= 6; c++)
      if (new Set([a, b, c]).size === 3) combos.push(`${a}-${b}-${c}`);
async function commit(index, ev) {
  const at = now + index * 1000,
    o = {
      ...obs,
      observedAt: iso(at - 1000),
      receivedAt: iso(at),
      odds: ev / 0.04,
    };
  const snapshot = {
    snapshotId: "test-" + index,
    raceId,
    raceDate: date,
    ruleVersion: p.RULE_VERSION,
    modelVersion: p.MODEL_VERSION,
    receivedAt: o.receivedAt,
    observations: combos.map((combination) => ({ ...o, combination })),
  };
  const entries = p.firstPurchases(o, new Set(), iso(now - 3600000), at);
  return db.query(
    "select public.four_page_commit_observation($1::jsonb,$2::jsonb) n",
    [JSON.stringify(snapshot), JSON.stringify(entries)],
  );
}
await assert.rejects(commit(0, 1.1), /paused|approved/);
assert.equal(
  (await db.query("select count(*)::int n from public.four_page_entries"))
    .rows[0].n,
  0,
);
await db.exec(
  `update public.four_page_recording_control set recording_enabled=true,approved_since='${iso(now - 3600000)}';`,
);
assert.equal((await commit(0, 1.1)).rows[0].n, 2);
assert.equal((await commit(0, 1.1)).rows[0].n, 0);
assert.equal((await commit(1, 1.25)).rows[0].n, 1);
assert.equal((await commit(2, 1.15)).rows[0].n, 0);
assert.equal((await commit(3, 1.3)).rows[0].n, 0);
const stored = (
  await db.query("select data from public.four_page_entries order by mode")
).rows.map((r) => r.data);
assert.equal(stored.length, 3);
assert.equal(stored.find((e) => e.mode === "both").ev, 1.1);
assert.equal(stored.find((e) => e.mode === "recommended").ev, 1.25);
// Force an earlier observation with a distinct id. It cannot rewrite first values.
await assert.rejects(commit(-1, 1.4), /Out-of-order/);
const result = {
  cancelled: false,
  refundedLanes: [],
  combination: "1-2-3",
  payoutPer100Yen: 1520,
  unsupported: false,
  confirmedAt: iso(now + 1100000),
};
for (const confirmedAt of [null, "not-a-date"]) {
  await db.query("select public.four_page_settle($1,$2::jsonb)", [
    raceId,
    JSON.stringify({ ...result, cancelled: true, confirmedAt }),
  ]);
  assert.ok(
    (await db.query("select data from public.four_page_entries")).rows.every(
      (r) => r.data.outcome === "checking" && r.data.payoutYen === null,
    ),
  );
}
await db.query("select public.four_page_settle($1,$2::jsonb)", [
  raceId,
  JSON.stringify({ ...result, unsupported: true }),
]);
assert.ok(
  (await db.query("select data from public.four_page_entries")).rows.every(
    (r) => r.data.outcome === "checking",
  ),
);
assert.equal(
  (
    await db.query("select public.four_page_settle($1,$2::jsonb) n", [
      raceId,
      JSON.stringify(result),
    ])
  ).rows[0].n,
  3,
);
assert.equal(
  (
    await db.query("select public.four_page_settle($1,$2::jsonb) n", [
      raceId,
      JSON.stringify({ ...result, payoutPer100Yen: 9999 }),
    ])
  ).rows[0].n,
  0,
);
assert.ok(
  (await db.query("select data from public.four_page_entries")).rows.every(
    (r) => r.data.payoutYen === 1520,
  ),
);
// Preserve the actual old first BUY values, then join the normalized read view.
await db.query("insert into public.races values($1)", [raceId]);
await db.query(
  "insert into public.research_strategies(strategy_version,effective_at,settings) values('legacy',now(),'{}')",
);
await db.query(
  "insert into public.research_signals(signal_id,race_id,combination,model_version,edge_version,strategy_version,cohort,status,created_at,buy_at,buy_odds,buy_ev,payout_yen,hit,settled_at) values('old',$1,'1-2-3','edge-full120-v2','edge-full120-v2','legacy','SHADOW_FORWARD','SETTLED',now(),now(),91,2.47,7070,true,now())",
  [raceId],
);
const old = (
  await db.query(
    "select data from public.four_page_ledger where rule_version='legacy'",
  )
).rows[0].data;
assert.equal(old.odds, 91);
assert.equal(old.ev, 2.47);
assert.equal(old.payoutYen, 7070);
assert.equal(old.probability, null);
assert.equal(old.calibratedProbability, null);
assert.equal(old.mode, "recommended");
await db.exec("set role anon;");
await assert.rejects(
  db.query("select * from public.four_page_entries"),
  /permission denied/,
);
await assert.rejects(
  db.query("select public.four_page_settle($1,$2::jsonb)", [
    raceId,
    JSON.stringify(result),
  ]),
  /permission denied/,
);
await db.exec("reset role;");
const rls = await db.query(
  "select relname,relrowsecurity from pg_class where relname in ('four_page_rule_drafts','four_page_recording_control','four_page_observations','four_page_entries','four_page_feed_status')",
);
assert.ok(rls.rows.every((r) => r.relrowsecurity));
await db.close();
console.log(
  "PASS: additive SQL executes on PostgreSQL; paused gate, 120 snapshots, first-purchase atomic dedup, chronology, unsupported outcomes, terminal settlement, legacy values, RLS and anon denial verified.",
);
