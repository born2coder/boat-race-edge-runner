import { EDGE_VERSION, type EdgeDayV2, type EdgeIndexV2, type Comparison } from "@/lib/edge-v2";
import { hasSupabaseReadConfiguration, queryString, supabaseRequest } from "@/db/supabase";

const base = "https://raw.githubusercontent.com/born2coder/boat-race-edge-runner/main/state/edge_v2";
export function validDate(date: string) { return /^20\d{2}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)); }

async function read<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${base}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const value = await response.json();
    return value.version === EDGE_VERSION ? value as T : null;
  } catch { return null; }
}

export function getEdgeV2Index() { return read<EdgeIndexV2>("index.json"); }
export function getEdgeV2Day(date: string) { return validDate(date) ? read<EdgeDayV2>(`days/${date}.json`) : Promise.resolve(null); }
export function getEdgeV2Summary(date: string) { return validDate(date) ? read<{version: string; comparison: Comparison[]}>(`summaries/${date}.json`) : Promise.resolve(null); }

export async function getDayResults(date: string) {
  if (!validDate(date) || !hasSupabaseReadConfiguration()) return null;
  const rows = await supabaseRequest<Array<{ race_id: string; combination: string; payout_per_100_yen: number;
    finishers: Array<{lane_no: number; result_code: string | null}> }>>(`results?${queryString({
      select: "race_id,combination,payout_per_100_yen,finishers", race_id: `like.BR:${date.replaceAll("-", "")}:*`, limit: 288,
    })}`);
  return rows.map((row) => ({race_id: row.race_id, combination: row.combination, payout_per_100_yen: row.payout_per_100_yen,
    refunded_lanes: row.finishers.filter((finisher) => /^(F|L)/.test(finisher.result_code ?? "")).map((finisher) => finisher.lane_no)}));
}
