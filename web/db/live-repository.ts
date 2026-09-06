import { fixture, type PocFixture, type Prediction, type Race, type Ticket } from "@/lib/poc";
import { hasSupabaseReadConfiguration, queryString, supabaseRequest } from "@/db/supabase";
import { getOfficialResult } from "@/db/official-results";

type DailyRunRow = {
  service_date: string;
  status: string;
  analyzed_count: number;
  recommended_count: number;
  skipped_count: number;
  incomplete_count: number;
  coverage_percent: number;
  finalized_at: string;
};

type RaceRow = {
  race_id: string;
  race_date: string;
  venue_code: string;
  venue_name: string;
  race_no: number;
  race_name: string | null;
  start_at: string;
  start_time_jst: string;
  entries: Race["entries"];
  result?: ResultRow | ResultRow[] | null;
};

type ResultRow = {
  race_id: string;
  finishers: NonNullable<Prediction["result"]>["finishers"];
  combination: string;
  payout_per_100_yen: number;
  weather?: string | null;
  wind_direction?: string | null;
  wind_speed_m?: number | null;
  wave_height_cm?: number | null;
};

export type EdgeCandidate = {
  edge_id: string; race_id: string; race_date: string; venue_name: string; venue_code: string;
  race_no: number; start_at: string; combination: string; predicted_probability: number;
  odds_decimal: number; expected_value_percent: number; threshold_percent: number;
  observed_at: string; status: "open" | "settled" | "excluded";
  result_combination?: string | null; payout_per_100_yen?: number | null; hit?: boolean | null;
};

export type EdgeProgress = {
  scheduled: number;
  observed: number;
  remaining: number;
  lastObservedAt: string | null;
};

type EdgeLedger = {
  schema_version: string;
  updated_at?: string;
  days: Array<{
    date: string;
    observed_count: number;
    last_observed_at: string | null;
    candidates: EdgeCandidate[];
  }>;
};

type PredictionRow = {
  prediction_id: string;
  race_id: string;
  model_version: string;
  strategy_version: string;
  selection_score: number;
  selection_reasons: string[];
  ranking: Prediction["ranking"];
  tickets: Ticket[];
  virtual_stake_yen: number;
  published_at: string;
  publication_mode: Prediction["publication_mode"];
  official_performance_eligible: boolean;
  publication_hash: string;
  race: RaceRow | RaceRow[];
  reassessment?: Array<{
    status: "supported" | "confirmed" | "cautious";
    observed_at: string;
  }> | {
    status: "supported" | "confirmed" | "cautious";
    observed_at: string;
  } | null;
};

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export function todayJst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function startOfWeek(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday);
  return value.toISOString().slice(0, 10);
}

function hydratePrediction(row: PredictionRow): Prediction | undefined {
  const raceRow = one(row.race);
  if (!raceRow) return undefined;
  const race: Race = {
    race_id: raceRow.race_id,
    race_date: raceRow.race_date,
    venue_code: raceRow.venue_code,
    venue: raceRow.venue_name,
    race_no: raceRow.race_no,
    race_name: raceRow.race_name ?? "一般",
    start_at: raceRow.start_at,
    start_time_jst: raceRow.start_time_jst,
    entries: raceRow.entries,
  };
  const tickets = row.tickets ?? [];
  const resultRow = one(raceRow.result);
  const reassessment = one(row.reassessment);
  const purchased = tickets.slice(0, 3);
  const stake = purchased.reduce((sum, ticket) => sum + ticket.stake_yen, 0);
  const result = resultRow && !resultRow.finishers.some((f) => f.finish_position === null || Boolean(f.result_code)) ? (() => {
    const lines = purchased.map((ticket) => ({
      ...ticket,
      return_yen: ticket.combination === resultRow.combination
        ? resultRow.payout_per_100_yen * ticket.stake_yen / 100
        : 0,
    }));
    const gross = lines.reduce((sum, line) => sum + line.return_yen, 0);
    return {
      finishers: resultRow.finishers,
      combination: resultRow.combination,
      payout_per_100_yen: resultRow.payout_per_100_yen,
      weather: resultRow.weather ?? undefined,
      wind_direction: resultRow.wind_direction ?? undefined,
      wind_speed_m: resultRow.wind_speed_m ?? undefined,
      wave_height_cm: resultRow.wave_height_cm ?? undefined,
      settlement: {
        status: "settled_forward" as const,
        result_combination: resultRow.combination,
        payout_per_100_yen: resultRow.payout_per_100_yen,
        original_stake_yen: stake,
        counted_stake_yen: stake,
        refund_yen: 0,
        gross_return_yen: gross,
        profit_yen: gross - stake,
        hit: gross > 0,
        lines,
      },
    };
  })() : null;

  return {
    prediction_id: row.prediction_id,
    race_id: row.race_id,
    model_version: row.model_version,
    strategy_version: row.strategy_version,
    selection_score: row.selection_score,
    selection_reasons: row.selection_reasons ?? [],
    ranking: row.ranking ?? [],
    tickets,
    virtual_stake_yen: stake || row.virtual_stake_yen,
    published_at: row.published_at,
    publication_mode: row.publication_mode,
    official_performance_eligible: row.official_performance_eligible
      && Date.parse(row.published_at) < Date.parse(raceRow.start_at),
    publication_hash: row.publication_hash,
    reassessment: reassessment ? {
      status: reassessment.status,
      observed_at: reassessment.observed_at,
    } : null,
    race,
    result,
  };
}

function emptyCurrentDay(date: string): PocFixture["current_day"] {
  return {
    date, venue_count: 0, analyzed_count: 0, recommended_count: 0, skipped_count: 0,
    incomplete_count: 0, coverage_percent: 0, status: "waiting", venues: [], predictions: [],
  };
}

// Results reference races, not predictions. Embed through the actual foreign key.
const joinedSelect = "*,race:races!inner(*,result:results(*)),reassessment:prediction_reassessments(status,observed_at)";

async function readPredictions(extra: Record<string, string | number | undefined> = {}) {
  const query = queryString({ select: joinedSelect, order: "published_at.desc", limit: 5000, ...extra });
  const rows = await supabaseRequest<PredictionRow[]>(`predictions?${query}`);
  // Only existing published records, only missing recent results, at most 20 races.
  // The archive importer remains the long-term reconciliation source.
  const now = Date.now();
  const pending = rows.filter((row) => {
    const race = one(row.race);
    if (!race || one(race.result)) return false;
    const age = now - Date.parse(race.start_at);
    return age >= 0 && age < 48 * 60 * 60 * 1000;
  }).slice(0, 20);
  await Promise.all(pending.map(async (row) => {
    const race = one(row.race)!;
    const roster = race.entries.map(({ lane_no, racer_id }) => ({ lane_no, racer_id }));
    const result = await getOfficialResult(race.race_id, JSON.stringify(roster));
    if (result) race.result = result;
  }));
  return rows.map(hydratePrediction).filter((item): item is Prediction => Boolean(item));
}

async function readOfficialPredictions(extra: Record<string, string | number | undefined> = {}) {
  const predictions = await readPredictions({
    publication_mode: "in.(morning_fixed_hit_v1,frozen_forward_hit_v1)",
    ...extra,
  });
  const preferred = new Map<string, Prediction>();
  for (const prediction of predictions) {
    const current = preferred.get(prediction.race_id);
    if (!current || prediction.publication_mode === "morning_fixed_hit_v1") {
      preferred.set(prediction.race_id, prediction);
    }
  }
  return Array.from(preferred.values());
}

// Called after authenticated ingestion too, so results can recover without visitors.
export async function recoverPublishedResults(serviceDate: string) {
  await readOfficialPredictions({ "race.race_date": `eq.${serviceDate}` });
}

export async function getPageFixture(): Promise<PocFixture> {
  const date = todayJst();
  if (!hasSupabaseReadConfiguration()) {
    return { ...fixture, current_day: emptyCurrentDay(date) };
  }
  try {
    const [runs, races, allPredictions] = await Promise.all([
      supabaseRequest<DailyRunRow[]>(`daily_runs?${queryString({ select: "*", service_date: `eq.${date}`, limit: 1 })}`),
      supabaseRequest<RaceRow[]>(`races?${queryString({ select: "*", race_date: `eq.${date}`, order: "venue_code.asc,race_no.asc" })}`),
      readOfficialPredictions({ "race.race_date": `eq.${date}` }),
    ]);
    const predictions = allPredictions.filter((prediction) => prediction.official_performance_eligible);
    const run = runs[0];
    if (!run) return { ...fixture, current_day: emptyCurrentDay(date) };
    const grouped = new Map<string, RaceRow[]>();
    for (const race of races) grouped.set(race.venue_code, [...(grouped.get(race.venue_code) ?? []), race]);
    const venues = Array.from(grouped.entries()).map(([venueCode, venueRaces]) => ({
      venue_code: venueCode,
      venue: venueRaces[0]?.venue_name ?? venueCode,
      race_count: venueRaces.length,
      target_races: predictions.filter((prediction) => prediction.race.venue_code === venueCode).map((prediction) => ({
        prediction_id: prediction.prediction_id,
        race_id: prediction.race_id,
        race_no: prediction.race.race_no,
        race_name: prediction.race.race_name,
        start_time_jst: prediction.race.start_time_jst,
        reassessment_status: prediction.reassessment?.status ?? null,
      })),
    })).sort((left, right) => right.target_races.length - left.target_races.length || left.venue_code.localeCompare(right.venue_code));
    return {
      ...fixture,
      generated_at: run.finalized_at,
      current_day: {
        date,
        venue_count: venues.length,
        analyzed_count: run.analyzed_count,
        recommended_count: predictions.length,
        excluded_prediction_count: allPredictions.length - predictions.length,
        skipped_count: Math.max(0, run.analyzed_count - predictions.length),
        incomplete_count: run.incomplete_count,
        coverage_percent: run.coverage_percent,
        status: run.status,
        venues,
        predictions,
      },
    };
  } catch {
    return { ...fixture, current_day: emptyCurrentDay(date) };
  }
}

const EDGE_LEDGER_URL = "https://raw.githubusercontent.com/born2coder/boat-race-edge-runner/main/state/edge_shadow/index.json";

async function getEdgeLedger(): Promise<EdgeLedger> {
  try {
    const response = await fetch(EDGE_LEDGER_URL, { next: { revalidate: 180 }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { schema_version: "unavailable", days: [] };
    const ledger = await response.json() as EdgeLedger;
    return Array.isArray(ledger.days) ? ledger : { schema_version: "invalid", days: [] };
  } catch {
    return { schema_version: "unavailable", days: [] };
  }
}

async function readEdgeDatabase(): Promise<EdgeCandidate[]> {
  if (!hasSupabaseReadConfiguration()) return [];
  try {
    return await supabaseRequest<EdgeCandidate[]>(`edge_candidates?${queryString({ select: "*", expected_value_percent: "gte.150", order: "race_date.desc,observed_at.desc", limit: 2000 })}`);
  } catch (error) {
    console.warn("EDGE candidate database unavailable; using audit ledger", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

async function attachEdgeResults(candidates: EdgeCandidate[]): Promise<EdgeCandidate[]> {
  if (!hasSupabaseReadConfiguration() || candidates.length === 0) return candidates;
  const raceIds = Array.from(new Set(candidates.map((candidate) => candidate.race_id)));
  try {
    const results = await supabaseRequest<ResultRow[]>(`results?${queryString({ select: "race_id,combination,payout_per_100_yen", race_id: `in.(${raceIds.join(",")})`, limit: 2000 })}`);
    const byRace = new Map(results.map((result) => [result.race_id, result]));
    return candidates.map((candidate) => {
      const result = byRace.get(candidate.race_id);
      if (!result) return candidate.status === "excluded" ? { ...candidate, status: "open" } : candidate;
      return {
        ...candidate,
        status: "settled" as const,
        result_combination: result.combination,
        payout_per_100_yen: result.payout_per_100_yen,
        hit: candidate.combination === result.combination,
      };
    });
  } catch {
    return candidates;
  }
}

/** EDGE verification is isolated from morning predictions and official HIT stats. */
export async function getEdgeDashboard() {
  const date = todayJst();
  const [ledger, databaseRows, runs] = await Promise.all([
    getEdgeLedger(),
    readEdgeDatabase(),
    hasSupabaseReadConfiguration()
      ? supabaseRequest<DailyRunRow[]>(`daily_runs?${queryString({ select: "*", service_date: `eq.${date}`, limit: 1 })}`).catch(() => [])
      : Promise.resolve([]),
  ]);
  const ledgerRows = ledger.days.flatMap((day) => day.candidates ?? []);
  const unique = new Map<string, EdgeCandidate>();
  for (const candidate of [...ledgerRows, ...databaseRows]) {
    if (candidate.expected_value_percent >= 150) unique.set(candidate.edge_id, candidate);
  }
  const candidates = await attachEdgeResults(Array.from(unique.values()));
  candidates.sort((left, right) => right.race_date.localeCompare(left.race_date)
    || Date.parse(right.start_at) - Date.parse(left.start_at)
    || right.expected_value_percent - left.expected_value_percent);
  const todayState = ledger.days.find((day) => day.date === date);
  const scheduled = runs[0]?.analyzed_count ?? 0;
  const observed = todayState?.observed_count ?? 0;
  return {
    date,
    today: candidates.filter((candidate) => candidate.race_date === date),
    history: candidates.filter((candidate) => candidate.race_date < date),
    progress: {
      scheduled,
      observed,
      remaining: Math.max(0, scheduled - observed),
      lastObservedAt: todayState?.last_observed_at ?? null,
    } satisfies EdgeProgress,
  };
}

export async function getEdgeCandidates(date = todayJst()): Promise<EdgeCandidate[]> {
  const dashboard = await getEdgeDashboard();
  return [...dashboard.today, ...dashboard.history].filter((candidate) => candidate.race_date === date);
}

export type YesterdayResultDay = { date: string; predictions: Prediction[] };

export async function getYesterdayResultDay(): Promise<YesterdayResultDay> {
  const date = shiftDate(todayJst(), -1);
  try {
    if (hasSupabaseReadConfiguration()) {
      const predictions = await readOfficialPredictions({ "race.race_date": `eq.${date}` });
      return { date, predictions };
    }
  } catch {
    // Keep the page honest when live reads are temporarily unavailable.
  }
  return { date, predictions: [] };
}

export async function getDisplayPredictions() {
  try {
    if (hasSupabaseReadConfiguration()) {
      const live = await readOfficialPredictions();
      return live;
    }
  } catch {
    // Return an empty public ledger rather than substituting test data.
  }
  return [];
}

export async function getDisplayPrediction(predictionId: string) {
  try {
    if (!hasSupabaseReadConfiguration()) return undefined;
    return (await readPredictions({ prediction_id: `eq.${predictionId}`, limit: 1 }))[0];
  } catch {
    return undefined;
  }
}

export type PerformancePeriod = {
  key: "week" | "month" | "year";
  label: string;
  startDate: string;
  endDate: string;
  settled: number;
  hits: number;
  hitRate: number | null;
  stake: number;
  returned: number;
  returnRate: number | null;
};

function summarizePeriod(
  predictions: Prediction[],
  period: Pick<PerformancePeriod, "key" | "label" | "startDate" | "endDate">,
): PerformancePeriod {
  const settled = predictions.filter((prediction) =>
    prediction.official_performance_eligible
    && prediction.race.race_date >= period.startDate
    && prediction.race.race_date <= period.endDate
    && prediction.result?.settlement,
  );
  const hits = settled.filter((prediction) => prediction.result?.settlement.hit).length;
  const stake = settled.reduce((sum, prediction) => sum + (prediction.result?.settlement.counted_stake_yen ?? 0), 0);
  const returned = settled.reduce((sum, prediction) => sum + (prediction.result?.settlement.gross_return_yen ?? 0), 0);
  return {
    ...period,
    settled: settled.length,
    hits,
    hitRate: settled.length ? hits / settled.length * 100 : null,
    stake,
    returned,
    returnRate: stake ? returned / stake * 100 : null,
  };
}

export async function getPerformancePeriods(): Promise<PerformancePeriod[]> {
  const endDate = todayJst();
  const periods: Array<Pick<PerformancePeriod, "key" | "label" | "startDate" | "endDate">> = [
    { key: "week", label: "今週", startDate: startOfWeek(endDate), endDate },
    { key: "month", label: "今月", startDate: `${endDate.slice(0, 7)}-01`, endDate },
    { key: "year", label: "今年", startDate: `${endDate.slice(0, 4)}-01-01`, endDate },
  ];
  try {
    if (hasSupabaseReadConfiguration()) {
      const predictions = await readOfficialPredictions();
      return periods.map((period) => summarizePeriod(predictions, period));
    }
  } catch {
    // Keep zero-count periods visible while live reads recover.
  }
  return periods.map((period) => summarizePeriod([], period));
}

export async function getObservationStats() {
  const empty = { predictions: 0, settled: 0, hits: 0, stake: 0, returned: 0, profit: 0, returnRate: null as number | null };
  try {
    if (!hasSupabaseReadConfiguration()) return empty;
    const predictions = (await readOfficialPredictions()).filter((prediction) => prediction.official_performance_eligible);
    const settled = predictions.filter((prediction) => prediction.result?.settlement);
    const hits = settled.filter((prediction) => prediction.result?.settlement.hit).length;
    const stake = settled.reduce((sum, prediction) => sum + (prediction.result?.settlement.counted_stake_yen ?? 0), 0);
    const returned = settled.reduce((sum, prediction) => sum + (prediction.result?.settlement.gross_return_yen ?? 0), 0);
    return { predictions: predictions.length, settled: settled.length, hits, stake, returned, profit: returned - stake, returnRate: stake ? returned / stake * 100 : null };
  } catch {
    return empty;
  }
}

export function buildPerformanceDetail(predictions: Prediction[], date: string, key: PerformancePeriod["key"]) {
  const labels = { week: "今週", month: "今月", year: "今年" };
  const startDate = key === "week" ? startOfWeek(date) : key === "month" ? `${date.slice(0, 7)}-01` : `${date.slice(0, 4)}-01-01`;
  const period = { key, label: labels[key], startDate, endDate: date };
  const eligible = predictions.filter((p) => p.official_performance_eligible && p.race.race_date >= startDate && p.race.race_date <= date);
  const grouped = new Map<string, Prediction[]>();
  for (const p of eligible) grouped.set(p.race.race_date, [...(grouped.get(p.race.race_date) ?? []), p]);
  let cumulativeProfit = 0;
  const days = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => {
    const summary = summarizePeriod(items, { ...period, startDate: day, endDate: day });
    cumulativeProfit += summary.returned - summary.stake;
    return { date: day, ...summary, published: items.length, pending: items.length - summary.settled, cumulativeProfit,
      predictions: [...items].sort((a, b) => a.race.start_at.localeCompare(b.race.start_at)) };
  }).reverse();
  return { ...summarizePeriod(eligible, period), published: eligible.length, pending: eligible.filter((p) => !p.result?.settlement).length, days };
}

export async function getPerformanceDetail(key: PerformancePeriod["key"]) {
  return buildPerformanceDetail(await getDisplayPredictions(), todayJst(), key);
}

export type TopKStat = { k: 1 | 3 | 5 | 8; settled: number; hits: number; hitRate: number | null; stake: number; returned: number; returnRate: number | null };

export async function getForwardTopKStats(): Promise<TopKStat[]> {
  const empty = ([1, 3, 5, 8] as const).map((k) => ({ k, settled: 0, hits: 0, hitRate: null, stake: 0, returned: 0, returnRate: null }));
  try {
    if (!hasSupabaseReadConfiguration()) return empty;
    const predictions = (await readOfficialPredictions()).filter((prediction) => prediction.official_performance_eligible && prediction.result);
    return ([1, 3, 5, 8] as const).map((k) => {
      const hits = predictions.filter((prediction) => prediction.tickets.slice(0, k).some((ticket) => ticket.combination === prediction.result?.combination));
      const returned = hits.reduce((sum, prediction) => sum + (prediction.result?.payout_per_100_yen ?? 0), 0);
      const stake = predictions.length * k * 100;
      return { k, settled: predictions.length, hits: hits.length, hitRate: predictions.length ? hits.length / predictions.length * 100 : null, stake, returned, returnRate: stake ? returned / stake * 100 : null };
    });
  } catch {
    return empty;
  }
}
