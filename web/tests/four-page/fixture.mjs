import { policy as p } from "./load-policy.mjs";
import { writeFile } from "node:fs/promises";
export function makeFixture(now = Date.now()) {
  const iso = (t) => new Date(t).toISOString(),
    date = p.jstDate(now),
    compact = date.replaceAll("-", "");
  const combinations = [];
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++)
        if (new Set([a, b, c]).size === 3) combinations.push(`${a}-${b}-${c}`);
  const observation = (
    raceId,
    combination,
    odds,
    close = now + 11 * 60000,
  ) => ({
    raceId,
    combination,
    closeAt: iso(close),
    observedAt: iso(now - 30000),
    receivedAt: iso(now - 20000),
    generatedAt: iso(now - 40000),
    probability: 0.05,
    calibratedProbability: null,
    conservativeProbability: 0.04,
    odds,
    officialCloseVerified: true,
    cancelled: false,
    resultKnown: false,
    modelVersion: p.MODEL_VERSION,
    ruleVersion: p.RULE_VERSION,
  });
  const observations = [
    ...combinations
      .slice(0, 5)
      .map((c, i) =>
        observation(
          `BR:${compact}:07:10`,
          c,
          [33.4125, 31.79, 29.99, 27, 26][i],
        ),
      ),
    ...combinations
      .slice(0, 2)
      .map((c, i) =>
        observation(`BR:${compact}:20:8`, c, [27, 26][i], now + 18 * 60000),
      ),
  ];
  const entries = [];
  for (const [offset, size, venue, rno] of [
    [1, 4, "06", 11],
    [2, 5, "20", 8],
    [3, 8, "07", 10],
    [4, 3, "01", 1],
  ]) {
    const day = p.jstDate(now - offset * 86400000),
      raceId = `BR:${day.replaceAll("-", "")}:${venue}:${rno}`;
    for (let i = 0; i < size; i++) {
      const source = now - offset * 86400000,
        close = source + 12 * 60000;
      const o = observation(raceId, combinations[i], 32.5 + i, close);
      o.observedAt = iso(source - 30000);
      o.receivedAt = iso(source - 20000);
      o.generatedAt = iso(source - 40000);
      const rows = p.firstPurchases(
        o,
        new Set(),
        iso(source - 86400000),
        source,
      );
      for (let e of rows) {
        e.minutesToClose = [20, 15, 10, 4][offset - 1];
        e.finalOdds = 20 + i;
        e.events = [
          { at: o.receivedAt, label: "購入推奨", odds: o.odds, ev: e.ev },
          { at: iso(source + 60000), label: "推奨解除", odds: 20, ev: 0.8 },
        ];
        e = p.settle(e, {
          cancelled: false,
          refundedLanes: [],
          combination: combinations[offset === 3 ? 4 : 0],
          payoutPer100Yen: offset === 1 ? 150 : 1520,
          unsupported: false,
          confirmedAt: iso(close + 8 * 60000),
        });
        entries.push(e);
      }
    }
  }
  const day = p.jstDate(now - 5 * 86400000),
    raceId = `BR:${day.replaceAll("-", "")}:24:12`,
    source = now - 5 * 86400000;
  for (const [i, ev] of [
    [0, 1.1],
    [1, 1.1996],
    [2, 1.21],
  ]) {
    const o = observation(
      raceId,
      combinations[i],
      ev / 0.04,
      source + 15 * 60000,
    );
    o.observedAt = iso(source - 30000);
    o.receivedAt = iso(source - 20000);
    const rows = p.firstPurchases(o, new Set(), iso(source - 86400000), source);
    for (let e of rows) {
      if (i === 0)
        e = p.settle(e, {
          cancelled: true,
          refundedLanes: [],
          combination: null,
          payoutPer100Yen: null,
          unsupported: false,
          confirmedAt: iso(source + 18 * 60000),
        });
      if (i === 1)
        e = p.settle(e, {
          cancelled: false,
          refundedLanes: [],
          combination: null,
          payoutPer100Yen: null,
          unsupported: true,
          confirmedAt: iso(source + 18 * 60000),
        });
      entries.push(e);
    }
  }
  // Separate legacy records make version separation visible without changing totals.
  const legacyVersion = "research-shadow-v1";
  entries.push(
    ...entries
      .filter((e) => e.mode === "recommended")
      .slice(0, 3)
      .map((e) => ({
        ...e,
        id: "legacy-" + e.id,
        ruleVersion: legacyVersion,
        odds: 91,
        ev: 2.47,
      })),
  );
  return {
    entries,
    feed: {
      updatedAt: iso(now - 20000),
      ended: 48,
      remaining: 96,
      confirming: 2,
      cancelled: 1,
      stopped: false,
      error: null,
      observations,
    },
    rules: [
      {
        version: p.RULE_VERSION,
        effectiveAt: null,
        settings: p.DEFAULT_RULE,
        legacy: false,
      },
      {
        version: legacyVersion,
        effectiveAt: iso(now - 10 * 86400000),
        settings: {
          minimumRawEv: 1.5,
          minimumConservativeEv: 1.2,
          watchEv: 1.05,
          maxCombinationsPerRace: 3,
          maxOddsAgeMinutes: 5,
          stakeYen: 100,
          conservativeFactor: 0.8,
        },
        legacy: true,
      },
    ],
    drafts: [],
  };
}
if (process.argv[2])
  await writeFile(process.argv[2], JSON.stringify(makeFixture(), null, 2));
