import fixtureJson from "@/lib/data/fixture.json";

export type Entry = {
  lane_no: number;
  racer_id: string;
  racer_name: string;
  age: number;
  branch: string;
  weight_kg: number;
  class: string;
  national_win_rate: number;
  national_2rate: number;
  local_win_rate: number;
  local_2rate: number;
  motor_no: number;
  motor_2rate: number;
  equipment_boat_no: number;
  boat_2rate: number;
};

export type Race = {
  race_id: string;
  race_date: string;
  venue_code: string;
  venue: string;
  race_no: number;
  race_name: string;
  start_at: string;
  start_time_jst: string;
  entries: Entry[];
};

export type Ticket = {
  bet_type: "trifecta";
  combination: string;
  stake_yen: number;
};

export type Ranking = {
  lane_no: number;
  racer_name: string;
  score: number;
  rank: number;
};

export type Settlement = {
  status: "settled_replay" | "settled_forward";
  result_combination: string;
  payout_per_100_yen: number;
  original_stake_yen: number;
  counted_stake_yen: number;
  refund_yen: number;
  gross_return_yen: number;
  profit_yen: number;
  hit: boolean;
  lines: Array<Ticket & { return_yen: number }>;
};

export type Prediction = {
  prediction_id: string;
  race_id: string;
  model_version: string;
  strategy_version: string;
  selection_score: number;
  selection_reasons: string[];
  ranking: Ranking[];
  tickets: Ticket[];
  virtual_stake_yen: number;
  published_at: string;
  publication_mode: "historical_replay" | "private_forward_poc" | "forward_observation_poc" | "frozen_forward_hit_v1" | "morning_fixed_hit_v1";
  official_performance_eligible: boolean;
  publication_hash: string;
  reassessment?: {
    status: "supported" | "confirmed" | "cautious";
    observed_at: string;
  } | null;
  race: Race;
  result: null | {
    finishers: Array<{
      finish_position: number | null;
      result_code: string | null;
      lane_no: number;
      racer_id: string;
    }>;
    combination: string;
    payout_per_100_yen: number;
    weather?: string;
    wind_direction?: string;
    wind_speed_m?: number;
    wave_height_cm?: number;
    settlement: Settlement;
  };
};

type Artifact = {
  kind: "B" | "K";
  date: string;
  url: string;
  fetched_at: string;
  content_sha256: string;
  byte_length: number;
};

export type PocFixture = {
  schema_version: string;
  generated_at: string;
  timezone: string;
  source_notice: string;
  artifacts: Artifact[];
  current_day: {
    date: string;
    venue_count: number;
    analyzed_count: number;
    recommended_count: number;
    skipped_count: number;
    incomplete_count: number;
    coverage_percent: number;
    status: string;
    venues: Array<{
      venue_code: string;
      venue: string;
      race_count: number;
      target_races: Array<{
        prediction_id: string;
        race_id: string;
        race_no: number;
        race_name: string;
        start_time_jst: string;
        reassessment_status?: "supported" | "confirmed" | "cautious" | null;
      }>;
    }>;
    predictions: Prediction[];
  };
  replay_day: {
    date: string;
    venue_count: number;
    race_count: number;
    entry_count: number;
    result_count: number;
    decisions: Array<{
      race_id: string;
      score: number;
      decision: "recommend" | "skip";
      reasons: string[];
    }>;
    predictions: Prediction[];
    stats: {
      published_predictions: number;
      settled_predictions: number;
      hits: number;
      hit_rate: number | null;
      total_stake_yen: number;
      total_return_yen: number;
      profit_yen: number;
      return_rate: number | null;
    };
  };
};

const rawFixture = fixtureJson as unknown as PocFixture;

function normalizeReplayPrediction(prediction: Prediction): Prediction {
  const tickets = prediction.tickets.slice(0, 3).map((ticket) => ({
    ...ticket,
    stake_yen: 100,
  }));
  const stake = tickets.reduce((sum, ticket) => sum + ticket.stake_yen, 0);
  if (!prediction.result) {
    return { ...prediction, tickets, virtual_stake_yen: stake };
  }

  const lines = tickets.map((ticket) => ({
    ...ticket,
    return_yen: ticket.combination === prediction.result?.combination
      ? prediction.result.payout_per_100_yen
      : 0,
  }));
  const grossReturn = lines.reduce((sum, line) => sum + line.return_yen, 0);
  return {
    ...prediction,
    tickets,
    virtual_stake_yen: stake,
    result: {
      ...prediction.result,
      settlement: {
        ...prediction.result.settlement,
        original_stake_yen: stake,
        counted_stake_yen: stake,
        gross_return_yen: grossReturn,
        profit_yen: grossReturn - stake,
        hit: grossReturn > 0,
        lines,
      },
    },
  };
}

const replayPredictions = rawFixture.replay_day.predictions.map(normalizeReplayPrediction);
const replaySettled = replayPredictions.flatMap((prediction) => prediction.result?.settlement ?? []);
const replayHits = replaySettled.filter((settlement) => settlement.hit).length;
const replayStake = replaySettled.reduce((sum, settlement) => sum + settlement.original_stake_yen, 0);
const replayReturn = replaySettled.reduce((sum, settlement) => sum + settlement.gross_return_yen, 0);

export const fixture: PocFixture = {
  ...rawFixture,
  replay_day: {
    ...rawFixture.replay_day,
    predictions: replayPredictions,
    stats: {
      ...rawFixture.replay_day.stats,
      published_predictions: replayPredictions.length,
      settled_predictions: replaySettled.length,
      hits: replayHits,
      hit_rate: replaySettled.length ? replayHits / replaySettled.length : null,
      total_stake_yen: replayStake,
      total_return_yen: replayReturn,
      profit_yen: replayReturn - replayStake,
      return_rate: replayStake ? replayReturn / replayStake : null,
    },
  },
};

export const allPredictions = [
  ...fixture.current_day.predictions,
  ...fixture.replay_day.predictions,
];

export function getPrediction(predictionId: string) {
  return allPredictions.find((prediction) => prediction.prediction_id === predictionId);
}

export const venueNames: Record<string, string> = {
  "01": "桐生", "02": "戸田", "03": "江戸川", "04": "平和島",
  "05": "多摩川", "06": "浜名湖", "07": "蒲郡", "08": "常滑",
  "09": "津", "10": "三国", "11": "びわこ", "12": "住之江",
  "13": "尼崎", "14": "鳴門", "15": "丸亀", "16": "児島",
  "17": "宮島", "18": "徳山", "19": "下関", "20": "若松",
  "21": "芦屋", "22": "福岡", "23": "唐津", "24": "大村",
};

export function formatYen(value: number) {
  const sign = value < 0 ? "−" : "";
  return `${sign}¥${Math.abs(value).toLocaleString("ja-JP")}`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function shortHash(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}
