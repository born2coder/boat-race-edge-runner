/** Adapt already saved EDGE observations. Never fetch odds or infer a model here. */
import {
  isPublicBeforeDeadline,
  snapshotDeadline,
  type EdgeRaceV2,
  type Snapshot,
  type EdgeDayV2,
} from "@/lib/edge-v2";
import { decimalProduct, type Observation } from "@/lib/four-page";
export function observationsFromSavedRace(
  race: EdgeRaceV2,
  snapshot: Snapshot,
  ruleVersion: string,
  conservativeFactor: number,
): Observation[] {
  const receivedAt = race.receipts?.[snapshot.snapshot_id];
  const quality =
    Boolean(receivedAt) &&
    isPublicBeforeDeadline(race, snapshot) &&
    snapshot.combinations.length === 120 &&
    new Set(snapshot.combinations).size === 120 &&
    snapshot.combinations.every(
      (c) => /^[1-6]-[1-6]-[1-6]$/.test(c) && new Set(c.split("-")).size === 3,
    ) &&
    snapshot.odds.length === 120 &&
    snapshot.exhibition?.length === 120 &&
    snapshot.exhibition.every((p) => Number.isFinite(p) && p >= 0 && p <= 1) &&
    Math.abs(snapshot.exhibition.reduce((a, b) => a + b, 0) - 1) <= 0.01 &&
    Number.isFinite(conservativeFactor) &&
    conservativeFactor > 0 &&
    conservativeFactor <= 1;
  return snapshot.combinations.map((combination, i) => ({
    raceId: race.race_id,
    combination,
    closeAt: snapshotDeadline(race, snapshot) ?? null,
    observedAt: snapshot.observed_at,
    receivedAt: receivedAt ?? "",
    generatedAt: snapshot.computed_at ?? null,
    probability: quality ? snapshot.exhibition![i] : null,
    calibratedProbability: null,
    conservativeProbability: quality
      ? decimalProduct(snapshot.exhibition![i], conservativeFactor)
      : null,
    odds: Number.isFinite(snapshot.odds[i]) ? snapshot.odds[i] : null,
    officialCloseVerified: quality,
    cancelled: Boolean(race.result?.cancelled),
    resultKnown: Boolean(race.result),
    modelVersion: snapshot.version,
    ruleVersion,
  }));
}
export function savedDayProgress(day: EdgeDayV2, now: number) {
  const races = Object.values(day.races),
    known = races.length > 0;
  const cancelled = races.filter((r) => r.result?.cancelled).length,
    ended = races.filter((r) => r.result && !r.result.cancelled).length;
  return {
    updatedAt: day.last_tick_at ?? null,
    ended: known ? ended : null,
    remaining: known ? races.length - ended - cancelled : null,
    cancelled: known ? cancelled : null,
    confirming: known
      ? races.filter((r) => !r.result && Date.parse(r.start_at) <= now).length
      : null,
  };
}
