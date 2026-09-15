import { cache } from "react";
import { EDGE_VERSION, type EdgeDayV2, type EdgeIndexV2, type Comparison } from "@/lib/edge-v2";
import { hasSupabaseReadConfiguration, queryString, supabaseRequest } from "@/db/supabase";

const repository = "born2coder/boat-race-edge-runner";
// One revision per render; the shared Next fetch cache bounds unauthenticated
// GitHub ref requests to about 30/hour across the page and receipt endpoint.
export const getEdgeV2Revision = cache(async (): Promise<string | null> => {
  try {
    const bucket = Math.floor(Date.now() / 120_000);
    const response = await fetch(`https://api.github.com/repos/${repository}/git/ref/heads/edge-data?bucket=${bucket}`,
      { next: { revalidate: 120 }, headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const value = await response.json();
    return /^[a-f0-9]{40}$/.test(value.object?.sha ?? "") ? value.object.sha : null;
  } catch { return null; }
});
export function validDate(date: string) { return /^20\d{2}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)); }

async function read<T>(path: string): Promise<T | null> {
  try {
    const revision = await getEdgeV2Revision();
    // Immutable commit URLs cannot serve a previous branch revision from CDN.
    // Fall back to the existing read path during GitHub API rate limiting.
    const ref = revision ?? "edge-data";
    const minute = Math.floor(Date.now() / 60_000);
    const response = await fetch(`https://raw.githubusercontent.com/${repository}/${ref}/state/edge_v2/${path}?minute=${minute}`,
      { cache: "no-store", signal: AbortSignal.timeout(12_000) });
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
    refunded_lanes: row.finishers.filter((finisher) => /^(F|L)/.test(finisher.result_code ?? "") || finisher.result_code === "K0").map((finisher) => finisher.lane_no)}));
}
