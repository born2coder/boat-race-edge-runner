import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname } from "node:path";
import { supabaseRequest, queryString } from "@/db/supabase";
import {
  DEFAULT_RULE,
  RULE_VERSION,
  MODEL_VERSION,
  jstDate,
  validateRule,
  type Entry,
  type Filters,
  type Observation,
  type Rule,
} from "@/lib/four-page";
export type RuleRecord = {
  version: string;
  effectiveAt: string | null;
  settings: Record<string, unknown>;
  legacy: boolean;
};
export type Draft = {
  draft_id: string;
  rule_version: string;
  created_at: string;
  effective_at: string;
  before_values: Rule;
  after_values: Rule;
  status: "draft";
};
export type Feed = {
  updatedAt: string | null;
  ended: number | null;
  remaining: number | null;
  confirming: number | null;
  cancelled: number | null;
  stopped: boolean;
  error: string | null;
  observations: Observation[];
};
type Fixture = {
  entries: Entry[];
  feed: Feed;
  rules: RuleRecord[];
  drafts: Draft[];
};
function fixturePath() {
  const path = process.env.FOUR_PAGE_FIXTURE_FILE;
  if (!path) return null;
  if (
    process.env.FOUR_PAGE_ISOLATED !== "1" ||
    process.env.VERCEL ||
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY
  )
    throw Error("テスト環境の分離条件を満たしていません。");
  return path;
}
export const requestNow = cache(async () => Date.now());
export const isolatedFixture = () => Boolean(fixturePath());
async function fixture() {
  const path = fixturePath();
  if (!path) return null;
  const local = JSON.parse(await readFile(path, "utf8")) as Fixture;
  try {
    const files = await readdir(path + ".drafts");
    const rows = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map((f) => readFile(path + ".drafts/" + f, "utf8")),
    );
    local.drafts.push(...rows.map((r) => JSON.parse(r) as Draft));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return local;
}
const configured = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const safeError = (error: unknown) => {
  console.error(
    "Four-page saved-data read failed",
    error instanceof Error ? error.name : "Error",
  );
  return "保存データを読み込めませんでした。DBの停止状態・接続設定・追加移行の適用状況を確認してください。";
};
const read = <T>(
  table: string,
  query: Record<string, string | number | undefined>,
) =>
  supabaseRequest<T>(
    table + "?" + queryString(query),
    { signal: AbortSignal.timeout(8000) },
    "service",
  );
const cachedLedger = unstable_cache(
  async (
    f: Pick<
      Filters,
      "from" | "to" | "rule" | "model" | "mode" | "cohort" | "venue"
    >,
  ) => {
    const entries: Entry[] = [];
    // Server-only bounded compact records. No raw 120-way historical replay.
    for (let offset = 0; offset <= 50000; offset += 1000) {
      const rows = await read<Array<{ data: Entry }>>("four_page_ledger", {
        select: "data",
        rule_version: "eq." + f.rule,
        model_version: f.model ? "eq." + f.model : undefined,
        mode: "eq." + f.mode,
        cohort: "eq." + f.cohort,
        and: `(race_date.gte.${f.from},race_date.lte.${f.to},race_id.gte.BR:${f.from.replaceAll("-", "")}:,race_id.lt.BR:${jstDate(Date.parse(f.to + "T00:00:00+09:00") + 86400000).replaceAll("-", "")}:)`,
        race_id: f.venue ? `like.BR:*:${f.venue}:*` : undefined,
        order: "race_date.desc,race_id.asc,id.asc",
        limit: 1000,
        offset,
      });
      if (offset === 50000 && rows.length)
        throw Error("期間が大きすぎます。期間を絞ってください。");
      entries.push(...rows.map((r) => r.data));
      if (rows.length < 1000) break;
    }
    return entries;
  },
  ["four-page-ledger-v1"],
  { revalidate: 60, tags: ["four-page-ledger"] },
);
export async function loadEntries(
  f: Filters,
): Promise<{ entries: Entry[]; error: string | null; available: boolean }> {
  try {
    const local = await fixture();
    if (local) return { entries: local.entries, error: null, available: true };
    if (!configured())
      return {
        entries: [],
        error: "保存データの接続設定がありません。",
        available: false,
      };
    return {
      entries: await cachedLedger({
        from: f.from,
        to: f.to,
        rule: f.rule,
        model: f.model,
        mode: f.mode,
        cohort: f.cohort,
        venue: f.venue,
      }),
      error: null,
      available: true,
    };
  } catch (error) {
    return {
      entries: [],
      error:
        error instanceof Error && error.message.startsWith("期間が")
          ? error.message
          : safeError(error),
      available: false,
    };
  }
}
export const loadRules = cache(async (): Promise<RuleRecord[]> => {
  try {
    const local = await fixture();
    if (local) return local.rules;
    const baseline: RuleRecord = {
      version: RULE_VERSION,
      effectiveAt: null,
      settings: DEFAULT_RULE,
      legacy: false,
    };
    if (!configured()) return [baseline];
    const controlRows = await read<
      Array<{
        rule_version: string;
        approved_since: string | null;
        settings: Record<string, unknown>;
      }>
    >("four_page_recording_control", {
      select: "rule_version,approved_since,settings",
      limit: 1000,
    });
    const old = await read<
      Array<{
        strategy_version: string;
        effective_at: string;
        settings: Record<string, unknown>;
      }>
    >("research_strategies", {
      select: "strategy_version,effective_at,settings",
      order: "effective_at.desc",
      limit: 1000,
    });
    return [
      ...(!controlRows.length
        ? [baseline]
        : controlRows.map((r) => ({
            version: r.rule_version,
            effectiveAt: r.approved_since,
            settings: r.settings,
            legacy: false,
          }))),
      ...old.map((r) => ({
        version: r.strategy_version,
        effectiveAt: r.effective_at,
        settings: r.settings,
        legacy: true,
      })),
    ];
  } catch {
    return [
      {
        version: RULE_VERSION,
        effectiveAt: null,
        settings: DEFAULT_RULE,
        legacy: false,
      },
    ];
  }
});
export const loadModels = cache(async () => {
  try {
    const local = await fixture();
    if (local)
      return [
        ...new Set([
          MODEL_VERSION,
          ...local.entries.map((e) => e.modelVersion),
        ]),
      ];
    if (!configured()) return [MODEL_VERSION];
    const rows = await read<Array<{ model_version: string }>>(
      "four_page_model_versions",
      { select: "model_version", limit: 1000 },
    );
    return [...new Set([MODEL_VERSION, ...rows.map((r) => r.model_version)])];
  } catch {
    return [MODEL_VERSION];
  }
});
export const loadRecordingState = cache(async () => {
  if (!configured() || isolatedFixture()) return false;
  try {
    const rows = await read<Array<{ recording_enabled: boolean }>>("four_page_recording_control", {
      select: "recording_enabled", rule_version: "eq."+RULE_VERSION, limit: 1,
    });
    return process.env.RESEARCH_FOUR_PAGE_RECORDING === "1" && rows[0]?.recording_enabled === true;
  } catch { return false; }
});
export async function loadFeed(): Promise<Feed> {
  const empty: Feed = {
    updatedAt: null,
    ended: null,
    remaining: null,
    confirming: null,
    cancelled: null,
    stopped: true,
    error: null,
    observations: [],
  };
  try {
    const local = await fixture();
    if (local) return local.feed;
    if (!configured())
      return { ...empty, error: "保存データの接続設定がありません。" };
    const status = await read<
      Array<{
        updated_at: string;
        data: Omit<Feed, "updatedAt" | "observations">;
      }>
    >("four_page_feed_status", {
      select: "updated_at,data",
      race_date: "eq." + jstDate(),
      limit: 1,
    });
    if (!status.length) return empty;
    const feed = {
      ...empty,
      ...status[0].data,
      updatedAt: status[0].updated_at,
      stopped:
        !(await loadRecordingState()) ||
        Date.now()-Date.parse(status[0].updated_at)>360000 ||
        status[0].data.stopped,
    };
    if (feed.stopped) return feed;
    const snapshots = await read<
      Array<{ data: { observations: Observation[] } }>
    >("four_page_active_observations", {
      select: "data",
      race_date: "eq." + jstDate(),
      rule_version: "eq." + RULE_VERSION,
      model_version: "eq." + MODEL_VERSION,
      limit: 288,
    });
    return {
      ...feed,
      observations: snapshots.flatMap((s) => s.data.observations),
    };
  } catch (error) {
    return { ...empty, error: safeError(error) };
  }
}
export async function loadDrafts(): Promise<{
  drafts: Draft[];
  error: string | null;
}> {
  try {
    const local = await fixture();
    if (local) return { drafts: local.drafts, error: null };
    if (!configured())
      return {
        drafts: [],
        error: "保存先の接続設定がありません。下書きはまだ保存できません。",
      };
    return {
      drafts: await read<Draft[]>("four_page_rule_drafts", {
        select: "*",
        order: "created_at.desc",
        limit: 100,
      }),
      error: null,
    };
  } catch (error) {
    return { drafts: [], error: safeError(error) };
  }
}
export async function saveRuleDraft(
  values: Record<string, unknown>,
  effectiveAt: string,
  requestId: string,
) {
  const rule = validateRule(values),
    now = new Date();
  if (
    !/^[a-f0-9-]{36}$/.test(requestId) ||
    !Number.isFinite(Date.parse(effectiveAt)) ||
    Date.parse(effectiveAt) < now.getTime() + 60000
  )
    throw Error("1分以上先の適用予定日時を指定してください。");
  const id = createHash("sha256")
    .update(requestId + JSON.stringify(rule) + effectiveAt)
    .digest("hex");
  const draft: Draft = {
    draft_id: id,
    rule_version: "four-page-draft-" + id.slice(0, 16),
    created_at: now.toISOString(),
    effective_at: effectiveAt,
    before_values: DEFAULT_RULE,
    after_values: rule,
    status: "draft",
  };
  const path = fixturePath();
  if (path) {
    const local = await fixture();
    if (!local) throw Error("テスト保存先がありません。");
    // Exclusive per-request file models DB PK deduplication across double submits.
    const output = path + ".drafts/" + id + ".json";
    await mkdir(dirname(output), { recursive: true });
    try {
      await writeFile(output, JSON.stringify(draft), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return draft.rule_version;
  }
  if (!configured()) throw Error("下書き保存先の接続設定がありません。");
  await supabaseRequest(
    "four_page_rule_drafts?on_conflict=draft_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(8000),
    },
    "service",
  );
  return draft.rule_version;
}
export { recordObservation, settleRecordedRace } from "@/db/four-page-writer";
export async function detailsFor(entries: Entry[]): Promise<Entry[]> {
  const local = await fixture();
  if (local) return entries;
  const legacy = entries.filter((e) => !e.ruleVersion.startsWith("four-page"));
  const enriched = new Map(entries.map((e) => [e.id, e]));
  for (let offset = 0; offset < legacy.length; offset += 40) {
    const batch = legacy.slice(offset, offset + 40);
    const filter =
      "in.(" +
      batch.map((e) => '"' + e.id.replaceAll('"', "") + '"').join(",") +
      ")";
    const rows = await read<
      Array<{
        signal_id: string;
        event_at: string;
        new_status: string;
        reason: string;
      }>
    >("research_signal_events", {
      select: "signal_id,event_at,new_status,reason",
      signal_id: filter,
      order: "event_at.asc",
      limit: 1000,
    });
    const labels: Record<string, string> = {
      WATCH: "買ってもよい（旧戦略）",
      BUY: "購入推奨（旧戦略）",
      CANCEL: "推奨解除",
      PASS: "非掲載",
      SETTLED: "結果・精算",
    };
    for (const e of batch)
      enriched.set(e.id, {
        ...e,
        events: rows
          .filter((r) => r.signal_id === e.id)
          .map((r) => ({
            at: r.event_at,
            label: labels[r.new_status] ?? "記録更新",
            odds: null,
            ev: null,
          })),
      });
  }
  const modern = entries.filter((e) => e.ruleVersion.startsWith("four-page"));
  for (let offset = 0; offset < modern.length; offset += 40) {
    const rows = await supabaseRequest<
      Array<{ id: string; events: NonNullable<Entry["events"]> }>
    >(
      "rpc/four_page_entry_events",
      {
        method: "POST",
        body: JSON.stringify({
          p_ids: modern.slice(offset, offset + 40).map((e) => e.id),
        }),
        signal: AbortSignal.timeout(8000),
      },
      "service",
    );
    for (const row of rows) {
      const entry = enriched.get(row.id);
      if (entry) enriched.set(row.id, { ...entry, events: row.events });
    }
  }
  return entries.map((e) => enriched.get(e.id)!);
}
