import "server-only";
import { supabaseRequest, queryString } from "@/db/supabase";
import { validateRule, firstPurchases, classify, type Observation, type OfficialResult, type Rule } from "@/lib/four-page";
const read = <T>(table: string, query: Record<string,string|number>) => supabaseRequest<T>(table+"?"+queryString(query),{signal:AbortSignal.timeout(8000)},"service");
/** Only a future, explicitly approved runner may call this. Reads never call it. */
export async function recordObservation(snapshot: {
  snapshotId: string;
  raceId: string;
  raceDate: string;
  ruleVersion: string;
  modelVersion: string;
  receivedAt: string;
  observations: Observation[];
}) {
  if (process.env.RESEARCH_FOUR_PAGE_RECORDING !== "1")
    throw Error("取得停止中");
  if (process.env.FOUR_PAGE_FIXTURE_FILE) throw Error("テスト画面から運転は開始できません。");
  const controls = await read<
    Array<{
      approved_since: string | null;
      recording_enabled: boolean;
      settings: Rule;
    }>
  >("four_page_recording_control", {
    select: "approved_since,recording_enabled,settings",
    rule_version: "eq." + snapshot.ruleVersion,
    model_version: "eq." + snapshot.modelVersion,
    limit: 1,
  });
  const c = controls[0];
  if (!c?.recording_enabled || !c.approved_since)
    throw Error("新ルールの記録開始は未承認です。");
  const rule = validateRule(c.settings);
  const now = Date.now(),
    sourceReceipt = Date.parse(snapshot.receivedAt);
  if (
    !Number.isFinite(sourceReceipt) ||
    sourceReceipt > now ||
    now - sourceReceipt > 30000 ||
    snapshot.observations.length !== 120 ||
    new Set(snapshot.observations.map((o) => o.combination)).size !== 120 ||
    snapshot.observations.some(
      (o) =>
        o.raceId !== snapshot.raceId ||
        o.ruleVersion !== snapshot.ruleVersion ||
        o.modelVersion !== snapshot.modelVersion ||
        o.receivedAt !== snapshot.receivedAt,
    )
  )
    throw Error("観測データの品質条件を満たしません。");
  const datasetQuality =
    snapshot.observations.every(
      (o) =>
        typeof o.probability === "number" &&
        o.probability >= 0 &&
        o.probability <= 1 &&
        /^[1-6]-[1-6]-[1-6]$/.test(o.combination) &&
        new Set(o.combination.split("-")).size === 3,
    ) &&
    Math.abs(
      snapshot.observations.reduce((sum, o) => sum + (o.probability ?? 0), 0) -
        1,
    ) <= 0.01;
  const entries = datasetQuality
    ? snapshot.observations.flatMap((o) =>
        firstPurchases(o, new Set(), c.approved_since, now, rule),
      )
    : [];
  const data = {
    ...snapshot,
    sourceReceivedAt: snapshot.receivedAt,
    receivedAt: new Date(now).toISOString(),
    assessments: snapshot.observations.map((o) => {
      const a = classify(o, now, false, rule);
      return {
        combination: o.combination,
        ...a,
        ...(!datasetQuality
          ? {
              category: "excluded",
              reasons: [...a.reasons, "確率総和・全120通り未確認"],
            }
          : {}),
      };
    }),
  };
  return supabaseRequest<number>(
    "rpc/four_page_commit_observation",
    {
      method: "POST",
      body: JSON.stringify({ p_snapshot: data, p_entries: entries }),
      signal: AbortSignal.timeout(8000),
    },
    "service",
  );
}
export async function settleRecordedRace(
  raceId: string,
  result: OfficialResult,
) {
  if (process.env.RESEARCH_FOUR_PAGE_RECORDING !== "1" || process.env.FOUR_PAGE_FIXTURE_FILE)
    throw Error("精算処理は停止中です。");
  return supabaseRequest<number>(
    "rpc/four_page_settle",
    {
      method: "POST",
      body: JSON.stringify({ p_race_id: raceId, p_result: result }),
      signal: AbortSignal.timeout(8000),
    },
    "service",
  );
}
