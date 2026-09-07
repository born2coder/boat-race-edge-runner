import type { IngestPayload } from "@/lib/ingest-schema";
import { queryString, SupabaseError, supabaseRequest } from "@/db/supabase";
import { canPublishReassessment } from "@/lib/reassessment-safety";

async function writeRows(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  resolution: "merge" | "ignore" = "merge",
) {
  if (rows.length === 0) return;
  await supabaseRequest(
    `${table}?${queryString({ on_conflict: onConflict })}`,
    {
      method: "POST",
      headers: { Prefer: `resolution=${resolution}-duplicates,return=minimal` },
      body: JSON.stringify(rows),
    },
    "service",
  );
}

export async function claimIngestionNonce(nonce: string, usedAt: string) {
  try {
    await supabaseRequest(
      "ingestion_nonces",
      { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ nonce, used_at: usedAt }) },
      "service",
    );
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 409) return false;
    throw error;
  }
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  supabaseRequest(`ingestion_nonces?${queryString({ used_at: `lt.${cutoff}` })}`, { method: "DELETE" }, "service").catch(() => undefined);
  return true;
}

type ExistingPrediction = { prediction_id: string; race_id: string; publication_mode: string; published_at: string; official_performance_eligible: boolean; race: { race_date: string; start_at: string } | Array<{ race_date: string; start_at: string }> };

export async function ingestLivePayload(payload: IngestPayload, rawBodySha256: string) {
  const ingestionId = `ingest_${rawBodySha256.slice(0, 24)}`;
  const prior = await supabaseRequest<Array<{ ingestion_id: string }>>(
    `ingestion_runs?${queryString({ select: "ingestion_id", ingestion_id: `eq.${ingestionId}`, limit: 1 })}`,
    {},
    "service",
  );
  if (prior.length > 0) return { status: "duplicate", ingestion_id: ingestionId };

  const existing = await supabaseRequest<ExistingPrediction[]>(
    `predictions?${queryString({
      select: "prediction_id,race_id,publication_mode,published_at,official_performance_eligible,race:races!inner(race_date,start_at)",
      publication_mode: "in.(forward_observation_poc,frozen_forward_hit_v1,morning_fixed_hit_v1)",
      "race.race_date": `eq.${payload.service_date}`,
    })}`,
    {},
    "service",
  );
  const existingKeys = new Set(existing.map((row) => `${row.publication_mode}:${row.race_id}`));
  const modeCounts = new Map<string, number>();
  for (const row of existing) modeCounts.set(row.publication_mode, (modeCounts.get(row.publication_mode) ?? 0) + 1);
  const acceptedPredictions = payload.predictions.filter((prediction) => {
    const key = `${prediction.publication_mode}:${prediction.race_id}`;
    if (existingKeys.has(key)) return false;
    const cap = ["frozen_forward_hit_v1", "morning_fixed_hit_v1"].includes(prediction.publication_mode) ? 10 : 3;
    const count = modeCounts.get(prediction.publication_mode) ?? 0;
    if (count >= cap) return false;
    existingKeys.add(key);
    modeCounts.set(prediction.publication_mode, count + 1);
    return true;
  });

  await writeRows("races", payload.races.map((race) => ({
    race_id: race.race_id,
    race_date: race.race_date,
    venue_code: race.venue_code,
    venue_name: race.venue,
    race_no: race.race_no,
    race_name: race.race_name,
    start_at: race.start_at,
    start_time_jst: race.start_time_jst,
    entries: race.entries,
    source_observed_at: payload.generated_at,
    status: payload.results.some((result) => result.race_id === race.race_id) ? "final" : "scheduled",
  })), "race_id");

  await writeRows("predictions", acceptedPredictions.map((prediction) => ({
    prediction_id: prediction.prediction_id,
    race_id: prediction.race_id,
    model_version: prediction.model_version,
    strategy_version: prediction.strategy_version,
    selection_score: prediction.selection_score,
    selection_reasons: prediction.selection_reasons,
    ranking: prediction.ranking,
    tickets: prediction.tickets,
    virtual_stake_yen: prediction.virtual_stake_yen,
    published_at: prediction.published_at,
    publication_mode: prediction.publication_mode,
    official_performance_eligible: prediction.official_performance_eligible,
    publication_hash: prediction.publication_hash,
  })), "prediction_id", "ignore");

  const assessmentPredictions = new Map(existing.map((row) => [row.prediction_id, row]));
  for (const prediction of acceptedPredictions) {
    const race = payload.races.find((row) => row.race_id === prediction.race_id);
    if (race) assessmentPredictions.set(prediction.prediction_id, { ...prediction, race });
  }
  const receivedAt = Date.now();
  const acceptedReassessments = payload.reassessments.filter((assessment) =>
    canPublishReassessment(assessment, assessmentPredictions.get(assessment.prediction_id), receivedAt));
  await writeRows("prediction_reassessments", acceptedReassessments.map((reassessment) => ({
    prediction_id: reassessment.prediction_id,
    race_id: reassessment.race_id,
    status: reassessment.status,
    top3_overlap: reassessment.top3_overlap,
    morning_percentile: reassessment.morning_percentile,
    exhibition_percentile: reassessment.exhibition_percentile,
    percentile_uplift: reassessment.percentile_uplift,
    rule_version: reassessment.rule_version,
    observed_at: reassessment.observed_at,
    reassessment_hash: reassessment.reassessment_hash,
  })), "prediction_id", "ignore");

  // The Git audit ledger is the durable fallback during verification. A missing
  // or temporarily unavailable EDGE table must not stop all-race observation.
  let storedEdgeCandidates = 0;
  try {
    await writeRows("edge_candidates", payload.edge_candidates, "edge_id", "ignore");
    storedEdgeCandidates = payload.edge_candidates.length;
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    console.error("EDGE candidate database write unavailable", error.status, error.responseText);
  }

  await writeRows("results", payload.results.map((result) => ({
    race_id: result.race_id,
    finishers: result.finishers,
    combination: result.combination,
    payout_per_100_yen: result.payout_per_100_yen,
    weather: result.weather ?? null,
    wind_direction: result.wind_direction ?? null,
    wind_speed_m: result.wind_speed_m ?? null,
    wave_height_cm: result.wave_height_cm ?? null,
    observed_at: payload.generated_at,
  })), "race_id");

  // Fetch candidates for the whole result batch once. Querying once per race made
  // a completed 144-race service day exceed the ingest function's time budget.
  if (payload.results.length > 0) {
    const resultsByRace = new Map(payload.results.map((result) => [result.race_id, result]));
    const raceIds = payload.results.map((result) => result.race_id);
    const edgeRows = await supabaseRequest<Array<{ edge_id: string; race_id: string; combination: string }>>(
      `edge_candidates?${queryString({
        select: "edge_id,race_id,combination",
        race_id: `in.(${raceIds.join(",")})`,
        limit: 2304,
      })}`,
      {},
      "service",
    );
    for (const row of edgeRows) {
      const result = resultsByRace.get(row.race_id);
      if (!result) continue;
      await supabaseRequest(
        `edge_candidates?${queryString({ edge_id: `eq.${row.edge_id}` })}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "settled",
            result_combination: result.combination,
            payout_per_100_yen: result.payout_per_100_yen,
            hit: row.combination === result.combination,
          }),
        },
        "service",
      );
    }
  }

  const analyzed = payload.summary?.scheduled_races ?? payload.races.length;
  const incomplete = payload.summary?.incomplete_races ?? 0;
  const recommended = modeCounts.get("morning_fixed_hit_v1") ?? modeCounts.get("frozen_forward_hit_v1") ?? 0;
  await writeRows("daily_runs", [{
    service_date: payload.service_date,
    status: "complete",
    analyzed_count: analyzed,
    recommended_count: recommended,
    skipped_count: Math.max(0, analyzed - recommended),
    incomplete_count: incomplete,
    coverage_percent: analyzed ? Math.round((analyzed - incomplete) / analyzed * 100) : 0,
    finalized_at: payload.generated_at,
    run_sha256: rawBodySha256,
  }], "service_date");

  await writeRows("ingestion_runs", [{
    ingestion_id: ingestionId,
    service_date: payload.service_date,
    dataset: payload.results.length ? "program+results" : "program",
    content_sha256: rawBodySha256,
    status: "complete",
    received_at: new Date().toISOString(),
    race_count: payload.races.length,
    prediction_count: acceptedPredictions.length,
    result_count: payload.results.length,
  }], "ingestion_id", "ignore");

  return {
    status: "complete",
    ingestion_id: ingestionId,
    service_date: payload.service_date,
    races: payload.races.length,
    predictions: acceptedPredictions.length,
    reassessments: acceptedReassessments.length,
    edge_candidates: payload.edge_candidates.length,
    edge_candidates_stored: storedEdgeCandidates,
    rejected_reassessments: payload.reassessments.length - acceptedReassessments.length,
    results: payload.results.length,
    settled: payload.results.length,
  };
}
