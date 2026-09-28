import type { EdgeDayV2, EdgeRaceV2, Phase, Snapshot } from "@/lib/edge-v2";
import { isPublicBeforeDeadline } from "@/lib/edge-v2";

export const STRATEGY_VERSION = "research-shadow-v1";
export const SETTINGS = Object.freeze({
  minimumRawEv: 1.5, minimumConservativeEv: 1.2, watchEv: 1.05,
  maxCombinationsPerRace: 3, maxOddsAgeMinutes: 5, stakeYen: 100,
  // This is an explicit provisional discount, not empirical probability calibration.
  conservativeFactor: 0.8,
});
export type ResearchStatus = "WATCH" | "BUY" | "CANCEL" | "PASS" | "SETTLED";
export type SignalEvent = { status: ResearchStatus; at: string; reason: string; odds: number; ev: number };
export type ResearchSignal = {
  id: string; race: EdgeRaceV2; combination: string; probability: number;
  conservativeProbability: number; odds: number; rawEv: number; conservativeEv: number;
  minimumOdds: number; status: ResearchStatus; observedAt: string;
  events: SignalEvent[]; buyAt?: string; buyOdds?: number; buyEv?: number;
  finalOdds?: number; payoutYen?: number; hit?: boolean; stakeYen?: number;
};
const phases: Phase[] = ["t20", "t15", "t10"];
const finite = (n: number) => Number.isFinite(n) && n > 0;
export const minimumOdds = (p: number, ev = SETTINGS.minimumConservativeEv) =>
  finite(p) && p <= 1 ? Math.ceil(ev / p * 10) / 10 : Infinity;
export const impliedProbability = (odds: number) => finite(odds) ? 1 / odds : null;
export const rawEv = (p: number, odds: number) => p * odds;
export function settlementFor(combination: string, result: NonNullable<EdgeRaceV2["result"]>, stakeYen: number = SETTINGS.stakeYen) {
  const refunded = result.cancelled || result.refunded_lanes.some(lane =>
    combination.split("-").includes(String(lane)));
  if (refunded) return {refunded: true, hit: null, payoutYen: stakeYen};
  const hit = combination === result.combination;
  return {refunded: false, hit, payoutYen: hit ? result.payout_per_100_yen : 0};
}
export const isFresh = (observed: string, now: number) =>
  Number.isFinite(Date.parse(observed)) && now >= Date.parse(observed) &&
  now - Date.parse(observed) <= SETTINGS.maxOddsAgeMinutes * 60_000;

function observations(race: EdgeRaceV2, requirePublicationReceipt = true) {
  return phases.flatMap(phase => race.snapshots[phase] ? [race.snapshots[phase]!] : [])
    .filter(s => s.combinations.length === 120 && s.odds.length === 120 &&
      s.morning.length === 120 && s.exhibition?.length === 120 &&
      Number.isFinite(Date.parse(s.observed_at)) &&
      Date.parse(s.observed_at) < Date.parse(race.start_at) &&
      (!requirePublicationReceipt || isPublicBeforeDeadline(race, s)))
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
}
function probability(s: Snapshot, i: number) {
  const p = s.exhibition?.[i];
  return p != null && finite(p) && p <= 1 ? p : null;
}
export function raceSignals(race: EdgeRaceV2, now = Date.now(), requirePublicationReceipt = true): ResearchSignal[] {
  const snapshots = observations(race, requirePublicationReceipt);
  if (!snapshots.length) return [];
  const first = snapshots[0];
  const ranked = first.combinations.map((combination, i) => ({
    combination, p: probability(first, i), odds: first.odds[i],
  })).filter((v): v is {combination: string; p: number; odds: number} =>
    v.p !== null && finite(v.odds))
    .sort((a, b) => b.p * b.odds - a.p * a.odds);
  // Freeze the candidate universe at the first eligible pre-deadline observation.
  const candidates = ranked.filter(v => v.p * v.odds >= SETTINGS.watchEv)
    .slice(0, SETTINGS.maxCombinationsPerRace);
  return candidates.map(v => {
    const events: SignalEvent[] = [];
    let status: ResearchStatus = "PASS";
    let buyAt: string | undefined, buyOdds: number | undefined, buyEv: number | undefined;
    let lastOdds = v.odds, lastAt = first.observed_at;
    for (const s of snapshots) {
      const i = s.combinations.indexOf(v.combination);
      if (i < 0 || !finite(s.odds[i])) continue;
      const odds = s.odds[i];
      const ev = v.p * SETTINGS.conservativeFactor * odds;
      const next: ResearchStatus = v.p * odds >= SETTINGS.minimumRawEv &&
        ev >= SETTINGS.minimumConservativeEv ? "BUY" :
        v.p * odds >= SETTINGS.watchEv ? "WATCH" : "PASS";
      if (next !== status) {
        const changed: ResearchStatus = status === "BUY" && next !== "BUY" ? "CANCEL" : next;
        events.push({status: changed, at: s.observed_at, reason: "odds threshold", odds, ev});
        if (changed === "CANCEL" && next === "WATCH") events.push({status: "WATCH", at: s.observed_at, reason: "threshold lost", odds, ev});
        status = next;
        if (next === "BUY" && !buyAt) {buyAt = s.observed_at; buyOdds = odds; buyEv = ev;}
      }
      lastOdds = odds; lastAt = s.observed_at;
    }
    // Never advertise a stale or expired observation as actionable.
    if (Date.parse(race.start_at) <= now || !isFresh(lastAt, now)) {
      status = "PASS";
    }
    const result = race.result;
    const refunded = result?.cancelled || result?.refunded_lanes?.some(lane => v.combination.split("-").includes(String(lane)));
    const stakeYen = buyAt && result && !refunded ? SETTINGS.stakeYen : undefined;
    const hit = stakeYen != null ? v.combination === result!.combination : undefined;
    const payoutYen = stakeYen != null ? hit ? result!.payout_per_100_yen : 0 : undefined;
    if (stakeYen != null) status = "SETTLED";
    return {
      id: [race.race_id, v.combination, STRATEGY_VERSION].join(":"), race, combination: v.combination,
      probability: v.p, conservativeProbability: v.p * SETTINGS.conservativeFactor,
      odds: lastOdds, rawEv: v.p * lastOdds, conservativeEv: v.p * SETTINGS.conservativeFactor * lastOdds,
      minimumOdds: minimumOdds(v.p * SETTINGS.conservativeFactor), status, observedAt: lastAt,
      events, buyAt, buyOdds, buyEv, finalOdds: race.final?.odds[v.combination],
      payoutYen, hit, stakeYen,
    };
  });
}
export function daySignals(day: EdgeDayV2 | null, now = Date.now()) {
  return Object.values(day?.races ?? {}).flatMap(r => raceSignals(r, now));
}
// Historical inspection may reconstruct candidates from immutable pre-deadline
// observations even when a publication receipt was lost. These records stay in
// BACKTEST and must never enter the SHADOW FORWARD ledger or actionable screens.
export function historicalDaySignals(day: EdgeDayV2 | null, now = Date.now()) {
  return Object.values(day?.races ?? {}).flatMap(r => raceSignals(r, now, false));
}
export function forwardPerformance(signals: ResearchSignal[]) {
  const settled = signals.filter(s => s.stakeYen != null && s.payoutYen != null);
  const stake = settled.reduce((n, s) => n + s.stakeYen!, 0);
  const payout = settled.reduce((n, s) => n + s.payoutYen!, 0);
  return { signals: signals.length, buys: signals.filter(s => s.buyAt).length,
    settled: settled.length, hits: settled.filter(s => s.hit).length, stake, payout,
    roi: stake ? payout / stake : null };
}
