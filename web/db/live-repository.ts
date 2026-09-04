import { fixture, type PocFixture, type Prediction, type Race, type Ticket } from "@/lib/poc";
import { hasSupabaseReadConfiguration, queryString, supabaseRequest } from "@/db/supabase";

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
  const result = resultRow ? (() => {
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
    official_performance_eligible: row.official_performance_eligible,
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

export async function getPageFixture(): Promise<PocFixture> {
  const date = todayJst();
  if (!hasSupabaseReadConfiguration()) {
    return { ...fixture, current_day: emptyCurrentDay(date) };
  }
  try {
    const [runs, races, predictions] = await Promise.all([
      supabaseRequest<DailyRunRow[]>(`daily_runs?${queryString({ select: "*", service_date: `eq.${date}`, limit: 1 })}`),
      supabaseRequest<RaceRow[]>(`races?${queryString({ select: "*", race_date: `eq.${date}`, order: "venue_code.asc,race_no.asc" })}`),
      readOfficialPredictions({ "race.race_date": `eq.${date}` }),
    ]);
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
    const predictions = await readOfficialPredictions();
    const settled = predictions.filter((prediction) => prediction.result?.settlement);
    const hits = settled.filter((prediction) => prediction.result?.settlement.hit).length;
    const stake = settled.reduce((sum, prediction) => sum + (prediction.result?.settlement.counted_stake_yen ?? 0), 0);
    const returned = settled.reduce((sum, prediction) => sum + (prediction.result?.settlement.gross_return_yen ?? 0), 0);
    return { predictions: predictions.length, settled: settled.length, hits, stake, returned, profit: returned - stake, returnRate: stake ? returned / stake * 100 : null };
  } catch {
    return empty;
  }
}

export type TopKStat = { k: 1 | 3 | 5 | 8; settled: number; hits: number; hitRate: number | null; stake: number; returned: number; returnRate: number | null };

export async function getForwardTopKStats(): Promise<TopKStat[]> {
  const empty = ([1, 3, 5, 8] as const).map((k) => ({ k, settled: 0, hits: 0, hitRate: null, stake: 0, returned: 0, returnRate: null }));
  try {
    if (!hasSupabaseReadConfiguration()) return empty;
    const predictions = (await readOfficialPredictions()).filter((prediction) => prediction.result);
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
