import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { policy as p } from "./four-page/load-policy.mjs";
const require = createRequire(import.meta.url),
  source = await readFile(
    new URL("../db/four-page-repository.ts", import.meta.url),
    "utf8",
  );
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
function repository(handler) {
  const exports = {};
  new Function("exports", "require", js)(exports, (name) => {
    if (name === "server-only") return {};
    if (name === "react") return { cache: (fn) => fn };
    if (name === "next/cache") return { unstable_cache: (fn) => fn };
    if (name === "@/lib/four-page") return p;
    if (name === "@/db/supabase")
      return {
        supabaseRequest: handler,
        queryString: (values) =>
          new URLSearchParams(
            Object.entries(values).filter(([, v]) => v !== undefined),
          ).toString(),
      };
    return require(name);
  });
  return exports;
}
const envKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "FOUR_PAGE_FIXTURE_FILE",
  "FOUR_PAGE_ISOLATED",
  "RESEARCH_FOUR_PAGE_RECORDING",
];
async function withEnv(values, fn) {
  const old = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  for (const k of envKeys) delete process.env[k];
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    for (const k of envKeys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}
test("read paths are GET-only and filter period/rule/model/mode/cohort/venue before pagination", () =>
  withEnv(
    {
      SUPABASE_URL: "http://localhost",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
    },
    async () => {
      const calls = [];
      const repo = repository(async (path, init, role) => {
        calls.push({ path, init, role });
        return [];
      });
      const f = p.filtersFrom({
        period: "custom",
        from: "2026-10-01",
        to: "2026-10-07",
        venue: "07",
        mode: "both",
      });
      const data = await repo.loadEntries(f);
      assert.equal(data.available, true);
      assert.equal(calls.length, 1);
      const q = new URL("http://localhost/" + calls[0].path).searchParams;
      assert.equal(q.get("rule_version"), "eq.four-page-v1");
      assert.equal(q.get("mode"), "eq.both");
      assert.equal(q.get("cohort"), "eq.forward");
      assert.equal(q.get("race_id"), "like.BR:*:07:*");
      assert.ok(q.get("and").includes("race_date.gte.2026-10-01"));
      assert.ok(q.get("and").includes("race_id.lt.BR:20261008:"));
      assert.equal(q.get("select"), "data");
      assert.equal(calls[0].init.method, undefined);
      assert.equal(calls[0].role, "service");
    },
  ));
test("unconfigured and failed read stays unknown, with no retry or official/ingest calls", async () => {
  await withEnv({}, async () => {
    const repo = repository(() => {
      throw Error("Must not call network");
    });
    const data = await repo.loadEntries(p.filtersFrom({}));
    assert.equal(data.available, false);
    assert.ok(data.error);
    const feed = await repo.loadFeed();
    assert.equal(feed.ended, null);
    assert.equal(feed.remaining, null);
    assert.equal(feed.stopped, true);
  });
  await withEnv(
    {
      SUPABASE_URL: "http://localhost",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
    },
    async () => {
      let calls = 0;
      const repo = repository(() => {
        calls++;
        throw Error("HTTP 429");
      });
      const data = await repo.loadEntries(p.filtersFrom({}));
      assert.equal(data.available, false);
      assert.equal(calls, 1);
    },
  );
});
test("recording and settlement are stopped before any DB write by default", () =>
  withEnv({}, async () => {
    const repo = repository(() => {
      throw Error("Must not touch DB");
    });
    await assert.rejects(repo.recordObservation({}), /停止/);
    await assert.rejects(repo.settleRecordedRace("race", {}), /停止/);
    await assert.rejects(
      repo.saveRuleDraft(
        p.DEFAULT_RULE,
        new Date(Date.now() + 600000).toISOString(),
        "00000000-0000-0000-0000-000000000000",
      ),
      /接続設定/,
    );
  }));
test("fixture mode fails closed when Vercel or real DB credentials coexist", () =>
  withEnv(
    {
      FOUR_PAGE_ISOLATED: "1",
      FOUR_PAGE_FIXTURE_FILE: "/tmp/not-read.json",
      SUPABASE_URL: "https://not-used",
    },
    async () => {
      const repo = repository(() => {
        throw Error("Must not call network");
      });
      assert.throws(() => repo.isolatedFixture(), /分離/);
      assert.equal(
        (await repo.loadEntries(p.filtersFrom({}))).available,
        false,
      );
    },
  ));
test("draft dedup uses stable ID and only touches the separate draft table", () =>
  withEnv(
    {
      SUPABASE_URL: "http://localhost",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
    },
    async () => {
      const calls = [],
        repo = repository(async (path, init) => {
          calls.push({ path, body: JSON.parse(init.body) });
          return null;
        });
      const date = new Date(Date.now() + 600000).toISOString(),
        id = "00000000-0000-0000-0000-000000000000";
      const a = await repo.saveRuleDraft(
          { ...p.DEFAULT_RULE, windowSeconds: 1140 },
          date,
          id,
        ),
        b = await repo.saveRuleDraft(
          { ...p.DEFAULT_RULE, windowSeconds: 1140 },
          date,
          id,
        );
      assert.equal(a, b);
      assert.equal(calls[0].body.draft_id, calls[1].body.draft_id);
      assert.ok(
        calls.every((c) => c.path.startsWith("four_page_rule_drafts?")),
      );
      assert.equal(calls[0].body.status, "draft");
      assert.equal(calls[0].body.before_values.windowSeconds, 1200);
      assert.equal(calls[0].body.after_values.windowSeconds, 1140);
    },
  ));
test("full saved matrix records all exclusion reasons; invalid probability sum creates no purchases", () =>
  withEnv(
    {
      SUPABASE_URL: "http://localhost",
      SUPABASE_SERVICE_ROLE_KEY: "test-only",
      RESEARCH_FOUR_PAGE_RECORDING: "1",
    },
    async () => {
      const now = Date.now(),
        iso = (t) => new Date(t).toISOString(),
        date = p.jstDate(now),
        raceId = `BR:${date.replaceAll("-", "")}:07:10`,
        combos = [];
      for (let a = 1; a <= 6; a++)
        for (let b = 1; b <= 6; b++)
          for (let c = 1; c <= 6; c++)
            if (new Set([a, b, c]).size === 3) combos.push(`${a}-${b}-${c}`);
      const calls = [],
        repo = repository(async (path, init) => {
          if (path.startsWith("four_page_recording_control?"))
            return [
              {
                recording_enabled: true,
                approved_since: iso(now - 3600000),
                settings: p.DEFAULT_RULE,
              },
            ];
          calls.push({ path, body: JSON.parse(init.body) });
          return 0;
        });
      const observations = combos.map((combination, i) => ({
        raceId,
        combination,
        closeAt: iso(now + 1200000),
        observedAt: iso(now - 1000),
        receivedAt: iso(now),
        generatedAt: null,
        probability: i === 0 ? 0.05 : 0.95 / 119,
        calibratedProbability: null,
        conservativeProbability: (i === 0 ? 0.05 : 0.95 / 119) * 0.8,
        odds: i === 0 ? 32.5 : 1,
        officialCloseVerified: true,
        cancelled: false,
        resultKnown: false,
        modelVersion: p.MODEL_VERSION,
        ruleVersion: p.RULE_VERSION,
      }));
      const snapshot = {
        snapshotId: "new",
        raceId,
        raceDate: date,
        ruleVersion: p.RULE_VERSION,
        modelVersion: p.MODEL_VERSION,
        receivedAt: iso(now),
        observations,
      };
      await repo.recordObservation(snapshot);
      assert.equal(calls[0].body.p_snapshot.assessments.length, 120);
      assert.equal(calls[0].body.p_entries.length, 2);
      assert.equal(calls[0].body.p_entries[0].cohort, "forward");
      await repo.recordObservation({
        ...snapshot,
        snapshotId: "bad",
        observations: observations.map((o) => ({ ...o, probability: 0.5 })),
      });
      assert.equal(calls[1].body.p_entries.length, 0);
      assert.ok(
        calls[1].body.p_snapshot.assessments.every(
          (a) =>
            a.category === "excluded" &&
            a.reasons.includes("確率総和・全120通り未確認"),
        ),
      );
    },
  ));
