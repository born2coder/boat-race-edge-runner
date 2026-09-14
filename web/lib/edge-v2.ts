export const EDGE_VERSION = "edge-full120-v2";
export const thresholds = [150, 175, 200, 300] as const;
export type Phase = "t20" | "t15" | "t10";
export type Model = "morning" | "exhibition";
export type Snapshot = {
  snapshot_id: string; version: string; phase: Phase; observed_at: string; computed_at: string;
  request_started_at: string; official_update_time: string; minutes_before: number;
  combinations: string[]; odds: number[]; morning: number[]; exhibition: number[] | null;
  exhibition_source_ready_at: string | null;
  exhibition_status?: string;
};
export type EdgeRaceV2 = {
  race_id: string; race_date: string; venue_code: string; venue: string; race_no: number; start_at: string;
  snapshots: Partial<Record<Phase, Snapshot>>; receipts?: Record<string, string>;
  result?: { combination: string; payout_per_100_yen: number; refunded_lanes: number[]; cancelled?: boolean };
  final?: { odds: Record<string, number>; observed_at: string; validation: string };
  errors?: Record<string, { at: string; reason: string }>;
};
export type Comparison = {
  phase: Phase; model: Model; threshold: number; scope: string; paired: boolean;
  observed_races: number; public_races: number; paired_races: number; selected_races: number;
  points: number; settled_points: number; pending_points: number; refunded_points: number;
  hits: number; stake_yen: number; payout_yen: number; return_rate: number | null;
  expected_hits: number; mean_expected_value: number | null;
  scored_races: number; log_loss_sum: number; brier_sum: number;
};
export type ProgressV2 = { scheduled: number; checked: number; phases: Record<Phase, number>;
  missed: Record<Phase, number>; final_grids: number; results: number; last_tick_at: string | null;
  exhibition?: Record<Phase, number>; pending_results?: number;
  result_error?: { kind: string; at: string } | null;
  last_error?: { kind: string; at: string } | null };
export type EdgeIndexV2 = { version: string; updated_at: string; days: Array<{date: string; progress: ProgressV2}>; comparison: Comparison[] };
export type EdgeDayV2 = { version: string; date: string; races: Record<string, EdgeRaceV2>;
  last_tick_at?: string | null; last_error?: ProgressV2["last_error"]; result_error?: ProgressV2["result_error"] };

export function dayProgress(day: EdgeDayV2, now = Date.now()): ProgressV2 {
  const races = Object.values(day.races);
  const phases = ["t20", "t15", "t10"] as const;
  const windowEnd = {t20: 17, t15: 13, t10: 8};
  const counts = (predicate: (race: EdgeRaceV2, phase: Phase) => boolean) =>
    Object.fromEntries(phases.map((phase) => [phase, races.filter((race) => predicate(race, phase)).length])) as Record<Phase, number>;
  return {
    scheduled: races.length, checked: races.filter((r) => Object.keys(r.snapshots).length > 0).length,
    phases: counts((r, p) => Boolean(r.snapshots[p])),
    missed: counts((r, p) => !r.snapshots[p] && (Date.parse(r.start_at) - now) / 60000 < windowEnd[p]),
    exhibition: counts((r, p) => r.snapshots[p]?.exhibition != null),
    final_grids: races.filter((r) => r.final).length, results: races.filter((r) => r.result).length,
    pending_results: races.filter((r) => !r.result && Date.parse(r.start_at) < now).length,
    last_tick_at: day.last_tick_at ?? null, last_error: day.last_error, result_error: day.result_error,
  };
}

export function isPublicBeforeDeadline(race: EdgeRaceV2, snapshot: Snapshot) {
  const receipt = race.receipts?.[snapshot.snapshot_id];
  return Boolean(receipt && Date.parse(snapshot.observed_at) <= Date.parse(receipt) && Date.parse(receipt) < Date.parse(race.start_at));
}

export function selectedPicks(snapshot: Snapshot, model: Model, threshold: number) {
  const probabilities = snapshot[model];
  if (!probabilities || probabilities.length !== 120 || snapshot.odds.length !== 120 || snapshot.combinations.length !== 120) return [];
  const order = probabilities.map((_, index) => index).sort((a, b) => probabilities[b] - probabilities[a] || snapshot.combinations[a].localeCompare(snapshot.combinations[b]));
  return order.map((index, rank) => ({ combination: snapshot.combinations[index], probability: probabilities[index],
    odds: snapshot.odds[index], expected: probabilities[index] * snapshot.odds[index] * 100, rank: rank + 1 }))
    .filter((pick) => pick.expected + 1e-9 >= threshold);
}
