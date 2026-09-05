import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { supabaseRequest } from "@/db/supabase";
import { parseOfficialResult } from "@/lib/official-result-parser";
import { officialResultUrl } from "@/lib/race-lifecycle";

// Shared cache bounds public-source requests; React cache deduplicates page sections.
const fetchResult = unstable_cache(async (raceId: string, rosterJson: string) => {
  const url = officialResultUrl(raceId);
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      console.warn("Official result HTTP status", raceId, response.status);
      return null;
    }
    const html = await response.text();
    if (html.length > 1_000_000) return null;
    return parseOfficialResult(html, raceId, JSON.parse(rosterJson), new Date().toISOString());
  } catch (error) {
    console.warn("Official result temporarily unavailable", raceId, error instanceof Error ? error.name : "UnknownError");
    return null;
  }
}, ["official-race-results-v2"], { revalidate: 60 });

export const getOfficialResult = cache(async (raceId: string, rosterJson: string) => {
  const result = await fetchResult(raceId, rosterJson);
  if (result) {
    after(async () => {
      try {
        // Insert only: never overwrite a stored result or any published prediction.
        await supabaseRequest("results?on_conflict=race_id", {
          method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify(result), signal: AbortSignal.timeout(5000),
        }, "service");
      } catch {
        console.error("Official result persistence failed; daily reconciliation will retry", raceId);
      }
    });
  }
  return result;
});
