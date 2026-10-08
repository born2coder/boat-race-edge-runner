import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { policy as p } from "./four-page/load-policy.mjs";
const require = createRequire(import.meta.url);
async function load(file, imports = {}) {
  const code = ts.transpileModule(
      await readFile(new URL("../" + file, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    exports = {};
  new Function("exports", "require", code)(
    exports,
    (name) => imports[name] ?? require(name),
  );
  return exports;
}
const edge = await load("lib/edge-v2.ts"),
  source = await load("lib/four-page-source.ts", {
    "@/lib/edge-v2": edge,
    "@/lib/four-page": p,
  });
const now = Date.parse("2026-10-08T05:00:00Z"),
  iso = (t) => new Date(t).toISOString();
const combinations = [];
for (let a = 1; a <= 6; a++)
  for (let b = 1; b <= 6; b++)
    for (let c = 1; c <= 6; c++)
      if (new Set([a, b, c]).size === 3) combinations.push(`${a}-${b}-${c}`);
const snapshot = {
  snapshot_id: "saved",
  version: p.MODEL_VERSION,
  phase: "t20",
  observed_at: iso(now - 1000),
  computed_at: iso(now - 2000),
  request_started_at: iso(now - 3000),
  official_update_time: iso(now - 1000),
  minutes_before: 20,
  combinations,
  odds: combinations.map(() => 32.5),
  morning: combinations.map(() => 1 / 120),
  exhibition: combinations.map((_, i) => (i === 0 ? 0.05 : 0.95 / 119)),
  exhibition_source_ready_at: iso(now - 5000),
};
const race = {
  race_id: "BR:20261008:07:10",
  race_date: "2026-10-08",
  venue_code: "07",
  venue: "蒲郡",
  race_no: 10,
  start_at: iso(now + 1200000),
  snapshots: { t20: snapshot },
  receipts: { saved: iso(now) },
};
test("saved-source adapter keeps all 120 predictions, source times and inherited factor without inference", () => {
  const rows = source.observationsFromSavedRace(
    race,
    snapshot,
    p.RULE_VERSION,
    0.8,
  );
  assert.equal(rows.length, 120);
  assert.equal(rows[0].probability, 0.05);
  assert.equal(rows[0].calibratedProbability, null);
  assert.equal(rows[0].conservativeProbability, 0.04);
  assert.equal(rows[0].generatedAt, snapshot.computed_at);
  assert.equal(rows[0].receivedAt, iso(now));
  assert.equal(p.classify(rows[0], now).category, "recommended");
});
for (const [label, patch, racePatch] of [
  ["missing matrix", { exhibition: null }, {}],
  [
    "unnormalized probabilities",
    { exhibition: combinations.map(() => 0.5) },
    {},
  ],
  [
    "duplicate combination",
    { combinations: combinations.map(() => "1-2-3") },
    {},
  ],
  ["no public receipt", {}, { receipts: {} }],
  ["after-deadline receipt", {}, { receipts: { saved: iso(now + 1200001) } }],
])
  test("quality rejects " + label, () => {
    const rows = source.observationsFromSavedRace(
      { ...race, ...racePatch },
      { ...snapshot, ...patch },
      p.RULE_VERSION,
      0.8,
    );
    assert.ok(rows.every((o) => p.classify(o, now).category === "excluded"));
  });
test("ended counts require results; closed pending remains, cancellation is separate, unknown is not zero", () => {
  const day = {
    version: p.MODEL_VERSION,
    date: "2026-10-08",
    races: {
      a: race,
      b: {
        ...race,
        race_id: "BR:20261008:07:9",
        result: {
          combination: "1-2-3",
          payout_per_100_yen: 100,
          refunded_lanes: [],
        },
      },
      c: { ...race, race_id: "BR:20261008:07:8", result: { cancelled: true } },
      d: { ...race, race_id: "BR:20261008:07:7", start_at: iso(now - 1000) },
    },
  };
  const progress = source.savedDayProgress(day, now);
  assert.deepEqual(
    [
      progress.ended,
      progress.remaining,
      progress.cancelled,
      progress.confirming,
    ],
    [1, 2, 1, 1],
  );
  assert.equal(
    source.savedDayProgress({ ...day, races: {} }, now).remaining,
    null,
  );
});
