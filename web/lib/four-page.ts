/** Shared display, purchase and accounting contract. No I/O or model inference. */
export const RULE_VERSION = "four-page-v1";
export const MODEL_VERSION = "edge-full120-v2";
export const DEFAULT_RULE = Object.freeze({
  windowSeconds: 1200,
  minimumProbability: 0.01,
  recommendedEv: 1.2,
  optionalEv: 1,
  stakeYen: 100,
  maxOddsAgeSeconds: 300,
  conservativeFactor: 0.8,
});
export type Rule = { -readonly [K in keyof typeof DEFAULT_RULE]: number };
export type Mode = "recommended" | "optional" | "both";
export type Cohort = "forward" | "backtest" | "live";
export type Category = "recommended" | "optional" | "excluded";
export const MODE_LABELS: Record<Mode, string> = {
  recommended: "購入推奨のみ",
  optional: "買ってもよいのみ",
  both: "両方",
};
export const CATEGORY_LABELS: Record<Category, string> = {
  recommended: "購入推奨",
  optional: "買ってもよい",
  excluded: "非掲載",
};
export type Observation = {
  raceId: string;
  combination: string;
  closeAt: string | null;
  observedAt: string;
  receivedAt: string;
  generatedAt: string | null;
  probability: number | null;
  calibratedProbability: number | null;
  conservativeProbability: number | null;
  odds: number | null;
  officialCloseVerified: boolean;
  cancelled: boolean;
  resultKnown: boolean;
  modelVersion: string;
  ruleVersion: string;
};
export type Assessment = {
  category: Category;
  ev: number | null;
  reasons: string[];
};
const probability = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 1;
/** Multiply the serialized decimal inputs once, avoiding repeated IEEE-754 rounding. */
export function decimalProduct(a: number, b: number): number {
  const parts = (n: number): [bigint, number] => {
    const [mantissa, exponent = "0"] = n.toString().split("e");
    const fraction = mantissa.split(".")[1]?.length ?? 0;
    return [BigInt(mantissa.replace(".", "")), Number(exponent) - fraction];
  };
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const [am, ae] = parts(a),
    [bm, be] = parts(b);
  return Number((am * bm).toString() + "e" + (ae + be));
}
export function classify(
  o: Observation,
  now: number,
  stopped = false,
  rule: Rule = DEFAULT_RULE,
): Assessment {
  const reasons: string[] = [];
  if (!Number.isFinite(now)) reasons.push("判定時刻未確認");
  const close = Date.parse(o.closeAt ?? ""),
    observed = Date.parse(o.observedAt),
    received = Date.parse(o.receivedAt);
  const remaining = (close - now) / 1000;
  if (stopped) reasons.push("取得停止中");
  if (
    !/^BR:\d{8}:(0[1-9]|1\d|2[0-4]):(?:0?[1-9]|1[0-2])$/.test(o.raceId) ||
    !/^([1-6])-([1-6])-([1-6])$/.test(o.combination) ||
    new Set(o.combination.split("-")).size !== 3
  )
    reasons.push("レース・買い目識別未確認");
  if (!o.officialCloseVerified || !Number.isFinite(close))
    reasons.push("公式締切未確認");
  else if (remaining <= 0) reasons.push("締切済み");
  else if (remaining > rule.windowSeconds) reasons.push("掲載開始前");
  if (o.cancelled) reasons.push("中止");
  if (o.resultKnown) reasons.push("結果確定済み");
  if (!probability(o.probability)) reasons.push("推定確率未取得・範囲外");
  else if (o.probability < rule.minimumProbability)
    reasons.push("推定確率未達");
  if (
    !probability(o.conservativeProbability) ||
    (probability(o.probability) && o.conservativeProbability > o.probability)
  )
    reasons.push("保守確率未取得・範囲外");
  if (o.calibratedProbability !== null && !probability(o.calibratedProbability))
    reasons.push("補正確率範囲外");
  if (typeof o.odds !== "number" || !Number.isFinite(o.odds) || o.odds < 1)
    reasons.push("オッズ未取得・範囲外");
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(received) ||
    observed > received ||
    received > now ||
    observed > now ||
    now - observed > rule.maxOddsAgeSeconds * 1000 ||
    received >= close
  )
    reasons.push("オッズ鮮度・事前公開未確認");
  const ev =
    probability(o.conservativeProbability) &&
    typeof o.odds === "number" &&
    Number.isFinite(o.odds) &&
    o.odds >= 1
      ? decimalProduct(o.conservativeProbability, o.odds)
      : null;
  if (ev !== null && ev <= rule.optionalEv) reasons.push("期待回収率未達");
  return {
    category:
      reasons.length || ev === null
        ? "excluded"
        : ev >= rule.recommendedEv
          ? "recommended"
          : "optional",
    ev,
    reasons,
  };
}
export type Entry = {
  id: string;
  raceId: string;
  raceDate: string;
  venueCode: string;
  raceNo: number;
  combination: string;
  modelVersion: string;
  ruleVersion: string;
  cohort: Cohort;
  mode: Mode;
  recordedAt: string;
  closeAt: string | null;
  category: Category;
  probability: number | null;
  calibratedProbability: number | null;
  conservativeProbability: number | null;
  odds: number | null;
  ev: number | null;
  minutesToClose: number | null;
  stakeYen: number;
  payoutYen: number | null;
  hit: boolean | null;
  outcome: "pending" | "hit" | "miss" | "refunded" | "checking";
  settledAt: string | null;
  finalOdds: number | null;
  resultCombination: string | null;
  sourceObservedAt: string;
  events?: Array<{
    at: string;
    label: string;
    odds: number | null;
    ev: number | null;
  }>;
};
export function purchaseKey(o: Observation, mode: Mode) {
  return [o.ruleVersion, o.modelVersion, mode, o.raceId, o.combination].join(
    "|",
  );
}
export function firstPurchases(
  o: Observation,
  prior: ReadonlySet<string>,
  approvedSince: string | null,
  now: number,
  rule: Rule = DEFAULT_RULE,
): Entry[] {
  if (
    !approvedSince ||
    !Number.isFinite(Date.parse(approvedSince)) ||
    Date.parse(o.observedAt) < Date.parse(approvedSince) ||
    Date.parse(o.receivedAt) < Date.parse(approvedSince) ||
    Date.parse(o.closeAt ?? "") - rule.windowSeconds * 1000 <
      Date.parse(approvedSince)
  )
    return [];
  const a = classify(o, now, false, rule);
  if (a.category === "excluded") return [];
  const [, date, venue, rno] = o.raceId.split(":");
  return ([a.category, "both"] as Mode[])
    .filter((mode) => !prior.has(purchaseKey(o, mode)))
    .map((mode) => ({
      id: purchaseKey(o, mode),
      raceId: o.raceId,
      raceDate: date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6),
      venueCode: venue,
      raceNo: Number(rno),
      combination: o.combination,
      modelVersion: o.modelVersion,
      ruleVersion: o.ruleVersion,
      cohort: "forward",
      mode,
      recordedAt: new Date(now).toISOString(),
      closeAt: o.closeAt,
      category: a.category,
      probability: o.probability,
      calibratedProbability: o.calibratedProbability,
      conservativeProbability: o.conservativeProbability,
      odds: o.odds,
      ev: a.ev,
      minutesToClose: (Date.parse(o.closeAt!) - now) / 60000,
      stakeYen: rule.stakeYen,
      payoutYen: null,
      hit: null,
      outcome: "pending",
      settledAt: null,
      finalOdds: null,
      resultCombination: null,
      sourceObservedAt: o.observedAt,
    }));
}
export type OfficialResult = {
  cancelled: boolean;
  refundedLanes: number[];
  combination: string | null;
  payoutPer100Yen: number | null;
  unsupported: boolean;
  confirmedAt: string;
};
export function settle(entry: Entry, result: OfficialResult): Entry {
  if (!["pending", "checking"].includes(entry.outcome)) return entry;
  if (!Number.isFinite(Date.parse(result.confirmedAt)))
    return { ...entry, outcome: "checking" };
  if (
    result.cancelled ||
    entry.combination
      .split("-")
      .some((x) => result.refundedLanes.includes(Number(x)))
  )
    return {
      ...entry,
      outcome: "refunded",
      hit: null,
      payoutYen: entry.stakeYen,
      settledAt: result.confirmedAt,
      resultCombination: result.combination,
    };
  if (
    result.unsupported ||
    !result.combination ||
    new Set(result.combination.split("-")).size !== 3 ||
    !/^([1-6])-([1-6])-([1-6])$/.test(result.combination) ||
    typeof result.payoutPer100Yen !== "number" ||
    !Number.isFinite(result.payoutPer100Yen) ||
    result.payoutPer100Yen <= 0
  )
    return { ...entry, outcome: "checking" };
  const hit = entry.combination === result.combination;
  return {
    ...entry,
    outcome: hit ? "hit" : "miss",
    hit,
    payoutYen: hit ? (result.payoutPer100Yen * entry.stakeYen) / 100 : 0,
    settledAt: result.confirmedAt,
    resultCombination: result.combination,
  };
}
export const jstDate = (time = Date.now()) =>
  new Date(time + 9 * 3600000).toISOString().slice(0, 10);
export const dateValid = (s: string) => {
  const parsed = Date.parse(s + "T00:00:00+09:00");
  return (
    /^20\d{2}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(parsed) &&
    jstDate(parsed) === s
  );
};

export type Filters = {
  period: string;
  from: string;
  to: string;
  month: string;
  year: string;
  mode: Mode;
  cohort: Cohort;
  rule: string;
  model: string;
  venue: string;
  result: string;
  category: string;
  search: string;
  evBand: string;
  probabilityBand: string;
  timeBand: string;
  page: number;
};
export function filtersFrom(
  query: Record<string, string | string[] | undefined>,
  history = false,
  now = Date.now(),
): Filters {
  const get = (key: string, fallback = "") =>
    typeof query[key] === "string"
      ? (query[key] as string).slice(0, 160)
      : fallback;
  const today = jstDate(now),
    month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(get("month"))
      ? get("month")
      : today.slice(0, 7),
    year = /^20\d{2}$/.test(get("year")) ? get("year") : today.slice(0, 4);
  const period = ["today", "week", "month", "year", "all", "custom"].includes(
    get("period"),
  )
    ? get("period")
    : history
      ? "week"
      : "month";
  let from = today,
    to = today;
  if (period === "week")
    from = jstDate(Date.parse(today + "T00:00:00+09:00") - 6 * 86400000);
  if (period === "month") {
    from = month + "-01";
    to = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
    )
      .toISOString()
      .slice(0, 10);
  }
  if (period === "year") {
    from = year + "-01-01";
    to = year + "-12-31";
  }
  if (period === "all") {
    from = "2000-01-01";
    to = today;
  }
  if (period === "custom") {
    if (
      !dateValid(get("from")) ||
      !dateValid(get("to")) ||
      get("from") > get("to")
    )
      throw Error("期間の開始日と終了日を正しく指定してください。");
    from = get("from");
    to = get("to");
  }
  return {
    period,
    from,
    to,
    month,
    year,
    mode: ["recommended", "optional", "both"].includes(get("mode"))
      ? (get("mode") as Mode)
      : "recommended",
    cohort: ["forward", "backtest", "live"].includes(get("cohort"))
      ? (get("cohort") as Cohort)
      : "forward",
    rule: get("rule", RULE_VERSION),
    model: get("model", MODEL_VERSION),
    venue: /^(0[1-9]|1\d|2[0-4])$/.test(get("venue")) ? get("venue") : "",
    result: get("result"),
    category: get("category"),
    search: get("search"),
    evBand: get("evBand"),
    probabilityBand: get("probabilityBand"),
    timeBand: get("timeBand"),
    page: Math.max(
      1,
      Math.min(1000, Math.floor(Number(get("page", "1"))) || 1),
    ),
  };
}
export const EV_BANDS = [
  { id: "100-110", label: "100％超〜110％未満", min: 1, max: 1.1 },
  { id: "110-120", label: "110〜120％未満", min: 1.1, max: 1.2 },
  { id: "120-130", label: "120〜130％未満", min: 1.2, max: 1.3 },
  { id: "130-150", label: "130〜150％未満", min: 1.3, max: 1.5 },
  { id: "150-200", label: "150〜200％未満", min: 1.5, max: 2 },
  { id: "200+", label: "200％以上", min: 2, max: Infinity },
];
export const PROBABILITY_BANDS = [
  { id: "0-1", label: "1％未満", min: 0, max: 0.01 },
  { id: "1-2", label: "1〜2％未満", min: 0.01, max: 0.02 },
  { id: "2-3", label: "2〜3％未満", min: 0.02, max: 0.03 },
  { id: "3-5", label: "3〜5％未満", min: 0.03, max: 0.05 },
  { id: "5-10", label: "5〜10％未満", min: 0.05, max: 0.1 },
  { id: "10+", label: "10％以上", min: 0.1, max: Infinity },
];
export const TIME_BANDS = [
  { id: "20-15", label: "20〜15分前", min: 15, max: 20 },
  { id: "15-10", label: "15〜10分前", min: 10, max: 15 },
  { id: "10-5", label: "10〜5分前", min: 5, max: 10 },
  { id: "5-0", label: "5分未満", min: 0, max: 5 },
];
export function bandFor(value: number | null, bands: typeof EV_BANDS) {
  return value === null
    ? null
    : (bands.find((b) => value >= b.min && value < b.max)?.id ?? null);
}
export function timeBand(value: number | null) {
  return value === null
    ? null
    : value > 15 && value <= 20
      ? "20-15"
      : value > 10 && value <= 15
        ? "15-10"
        : value >= 5 && value <= 10
          ? "10-5"
          : value > 0 && value < 5
            ? "5-0"
            : null;
}
export function selectEntries(
  entries: Entry[],
  f: Filters,
  venues: Record<string, string> = {},
) {
  const needle = f.search.toLowerCase();
  return entries.filter(
    (e) =>
      e.raceDate >= f.from &&
      e.raceDate <= f.to &&
      e.mode === f.mode &&
      e.cohort === f.cohort &&
      e.ruleVersion === f.rule &&
      (!f.model || e.modelVersion === f.model) &&
      (!f.venue || e.venueCode === f.venue) &&
      (!f.result || e.outcome === f.result) &&
      (!f.category || e.category === f.category) &&
      (!f.evBand || bandFor(e.ev, EV_BANDS) === f.evBand) &&
      (!f.probabilityBand ||
        bandFor(e.conservativeProbability, PROBABILITY_BANDS) ===
          f.probabilityBand) &&
      (!f.timeBand || timeBand(e.minutesToClose) === f.timeBand) &&
      (!needle ||
        `${venues[e.venueCode] ?? ""} ${e.raceId} ${e.raceNo}R ${e.combination}`
          .toLowerCase()
          .includes(needle)),
  );
}
export function groupRaces(entries: Entry[]) {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = e.raceId;
    const rows = groups.get(key);
    if (rows) rows.push(e);
    else groups.set(key, [e]);
  }
  return [...groups.values()]
    .map((rows) =>
      rows.sort(
        (a, b) =>
          (b.ev ?? -Infinity) - (a.ev ?? -Infinity) ||
          a.combination.localeCompare(b.combination),
      ),
    )
    .sort(
      (a, b) =>
        b[0].raceDate.localeCompare(a[0].raceDate) ||
        a[0].venueCode.localeCompare(b[0].venueCode) ||
        a[0].raceNo - b[0].raceNo,
    );
}
export function aggregate(entries: Entry[]) {
  const seen = new Set<string>();
  entries = entries.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  const valid = entries.filter(
    (e) =>
      ["hit", "miss"].includes(e.outcome) &&
      e.payoutYen !== null &&
      e.settledAt,
  );
  const pending = entries.filter((e) =>
      ["pending", "checking"].includes(e.outcome),
    ),
    refunds = entries.filter((e) => e.outcome === "refunded");
  const stake = valid.reduce((s, e) => s + e.stakeYen, 0),
    payout = valid.reduce((s, e) => s + e.payoutYen!, 0),
    hits = valid.filter((e) => e.hit === true).length;
  const allByRace = new Map<string, Entry[]>();
  for (const e of entries) {
    const rows = allByRace.get(e.raceId);
    if (rows) rows.push(e);
    else allByRace.set(e.raceId, [e]);
  }
  const races = groupRaces(valid)
    .map((rows) => ({
      rows,
      at: rows.reduce((s, e) => (e.settledAt! > s ? e.settledAt! : s), ""),
      profit: rows.reduce((s, e) => s + e.payoutYen! - e.stakeYen, 0),
      lost: rows.every((e) => e.hit === false),
    }))
    .sort(
      (a, b) =>
        a.at.localeCompare(b.at) ||
        a.rows[0].raceId.localeCompare(b.rows[0].raceId),
    );
  let losing = 0,
    maxLosing = 0,
    cumulative = 0,
    peak = 0,
    drawdown = 0;
  const blocks = new Map<string, number>();
  for (const race of races) {
    const complete = allByRace
      .get(race.rows[0].raceId)!
      .every((e) => !["pending", "checking"].includes(e.outcome));
    if (complete) {
      losing = race.lost ? losing + 1 : 0;
      maxLosing = Math.max(maxLosing, losing);
    } else losing = 0;
    blocks.set(race.at, (blocks.get(race.at) ?? 0) + race.profit);
  }
  const curve = [{ at: "開始", profit: 0 }];
  for (const [at, profit] of blocks) {
    cumulative += profit;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
    curve.push({ at, profit: cumulative });
  }
  const mean = (get: (e: Entry) => number | null) => {
    const values = valid
      .map(get)
      .filter((x): x is number => x !== null && Number.isFinite(x));
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
  };
  return {
    purchases: entries.length,
    settled: valid.length,
    hits,
    stake,
    payout,
    profit: payout - stake,
    roi: stake ? (payout / stake) * 100 : null,
    hitRate: valid.length ? (hits / valid.length) * 100 : null,
    races: races.length,
    maxLosing,
    drawdown,
    pending: pending.length,
    pendingStake: pending.reduce((s, e) => s + e.stakeYen, 0),
    refunds: refunds.length,
    refundAmount: refunds.reduce((s, e) => s + (e.payoutYen ?? 0), 0),
    curve,
    meanEv: mean((e) => e.ev),
    meanProbability: mean((e) => e.probability),
    meanCalibrated: mean((e) => e.calibratedProbability),
    meanConservative: mean((e) => e.conservativeProbability),
  };
}
export function linkFilters(
  f: Filters,
  overrides: Partial<Filters> = {},
  path = "/signal-log",
) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...f,
    ...overrides,
    page: overrides.page ?? 1,
  })) {
    if (value !== "") q.set(key, String(value));
  }
  return path + "?" + q.toString();
}
export function validateRule(value: Record<string, unknown>): Rule {
  const keys = Object.keys(DEFAULT_RULE) as (keyof Rule)[];
  const rule: Rule = { ...DEFAULT_RULE };
  for (const key of keys) {
    const n = Number(value[key]);
    if (!Number.isFinite(n)) throw Error("数値を正しく入力してください。");
    rule[key] = n;
  }
  if (
    rule.windowSeconds < 60 ||
    rule.windowSeconds % 60 !== 0 ||
    rule.windowSeconds > 1200 ||
    !Number.isInteger(rule.windowSeconds) ||
    [rule.minimumProbability, rule.recommendedEv, rule.optionalEv].some(
      (n) => Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-7,
    ) ||
    rule.minimumProbability <= 0 ||
    rule.minimumProbability > 1 ||
    rule.recommendedEv <= rule.optionalEv ||
    rule.recommendedEv > 10 ||
    rule.optionalEv < 1 ||
    rule.stakeYen !== 100 ||
    rule.maxOddsAgeSeconds !== DEFAULT_RULE.maxOddsAgeSeconds ||
    rule.conservativeFactor !== DEFAULT_RULE.conservativeFactor
  )
    throw Error(
      "掲載時間は1〜20分（1分刻み）、推定確率は0％超〜100％、推奨境界は下限超〜1000％、下限は100％以上です。購入額・鮮度・係数は固定です。",
    );
  return rule;
}

/** Increase precision rather than rounding an optional entry into a recommendation. */
export function expectedReturnText(ev: number | null) {
  if (ev === null) return "—";
  const pct = ev * 100;
  for (const digits of [2, 4, 6, 8]) {
    const rounded = Number(pct.toFixed(digits));
    if ((ev > 1 && rounded <= 100) || (ev < 1.2 && rounded >= 120)) continue;
    return (
      pct.toLocaleString("ja-JP", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }) + "％"
    );
  }
  return ev < 1.2 && ev > 1.1 ? "120％未満" : "100％超";
}
