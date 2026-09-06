import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const entrySchema = z.object({
  lane_no: z.number().int().min(1).max(6),
  racer_id: z.string().min(1).max(12),
  racer_name: z.string().min(1).max(40),
  age: z.number().int().min(15).max(100),
  branch: z.string().max(12),
  weight_kg: z.number().min(0).max(100),
  class: z.string().min(1).max(8),
  national_win_rate: z.number().min(0).max(10),
  national_2rate: z.number().min(0).max(100),
  local_win_rate: z.number().min(0).max(10),
  local_2rate: z.number().min(0).max(100),
  motor_no: z.number().int().min(0).max(999),
  motor_2rate: z.number().min(0).max(100),
  equipment_boat_no: z.number().int().min(0).max(999),
  boat_2rate: z.number().min(0).max(100),
});

const raceSchema = z.object({
  race_id: z.string().regex(/^BR:\d{8}:\d{2}:\d{2}$/),
  race_date: isoDate,
  venue_code: z.string().regex(/^\d{2}$/),
  venue: z.string().min(1).max(20),
  race_no: z.number().int().min(1).max(12),
  race_name: z.string().max(100),
  start_at: z.string().datetime({ offset: true }),
  start_time_jst: z.string().regex(/^\d{2}:\d{2}$/),
  entries: z.array(entrySchema).length(6),
});

const rankingSchema = z.object({
  lane_no: z.number().int().min(1).max(6),
  racer_name: z.string().min(1).max(40),
  score: z.number(),
  rank: z.number().int().min(1).max(6),
});

const ticketSchema = z.object({
  bet_type: z.literal("trifecta"),
  combination: z.string().regex(/^[1-6]-[1-6]-[1-6]$/),
  stake_yen: z.number().int().positive().multipleOf(100),
});

const predictionSchema = z.object({
  prediction_id: z.string().regex(/^pred_[a-f0-9]{20}$/),
  race_id: z.string(),
  model_version: z.enum(["poc-score-v0.1", "W_dynamic10_v1", "W_morning_badge_v1"]),
  strategy_version: z.enum(["fixed-3tickets-v0.1", "top3-flat100-v1", "morning-top3-flat100-v1"]),
  selection_score: z.number().int().min(0).max(100),
  selection_reasons: z.array(z.string().min(1).max(200)).min(1).max(8),
  ranking: z.array(rankingSchema).min(3).max(6),
  tickets: z.array(ticketSchema).min(3).max(8),
  virtual_stake_yen: z.number().int().nonnegative().multipleOf(100),
  published_at: z.string().datetime({ offset: true }),
  publication_mode: z.enum(["forward_observation_poc", "frozen_forward_hit_v1", "morning_fixed_hit_v1"]),
  official_performance_eligible: z.boolean(),
  publication_hash: sha,
}).superRefine((prediction, context) => {
  if (prediction.model_version === "W_dynamic10_v1") {
    if (prediction.strategy_version !== "top3-flat100-v1") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["strategy_version"], message: "Frozen HIT predictions require top3-flat100-v1" });
    }
    if (prediction.publication_mode !== "frozen_forward_hit_v1" || !prediction.official_performance_eligible) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["publication_mode"], message: "Frozen HIT predictions must be genuine forward records" });
    }
    if (prediction.tickets.length !== 8 || new Set(prediction.tickets.map((ticket) => ticket.combination)).size !== 8) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["tickets"], message: "Frozen HIT predictions require eight unique ranked combinations" });
    }
    if (prediction.tickets.some((ticket) => ticket.stake_yen !== 100) || prediction.virtual_stake_yen !== 300) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["virtual_stake_yen"], message: "Top3 validation is three 100-yen tickets" });
    }
  }
  if (prediction.model_version === "W_morning_badge_v1") {
    if (prediction.strategy_version !== "morning-top3-flat100-v1") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["strategy_version"], message: "Morning HIT predictions require morning-top3-flat100-v1" });
    }
    if (prediction.publication_mode !== "morning_fixed_hit_v1" || !prediction.official_performance_eligible) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["publication_mode"], message: "Morning HIT predictions must be genuine forward records" });
    }
    if (prediction.tickets.length !== 8 || new Set(prediction.tickets.map((ticket) => ticket.combination)).size !== 8) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["tickets"], message: "Morning HIT predictions require eight unique ranked combinations" });
    }
    if (prediction.tickets.some((ticket) => ticket.stake_yen !== 100) || prediction.virtual_stake_yen !== 300) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["virtual_stake_yen"], message: "Top3 validation is three 100-yen tickets" });
    }
  }
});

const reassessmentSchema = z.object({
  prediction_id: z.string().regex(/^pred_[a-f0-9]{20}$/),
  race_id: z.string().regex(/^BR:\d{8}:\d{2}:\d{2}$/),
  status: z.enum(["supported", "confirmed", "cautious"]),
  top3_overlap: z.number().int().min(0).max(3),
  morning_percentile: z.number().min(0).max(1),
  exhibition_percentile: z.number().min(0).max(1),
  percentile_uplift: z.number().min(-1).max(1),
  rule_version: z.literal("exhibition-support-v1"),
  observed_at: z.string().datetime({ offset: true }),
  reassessment_hash: sha,
});

const resultSchema = z.object({
  race_id: z.string(),
  finishers: z.array(z.object({
    finish_position: z.number().int().nullable(),
    result_code: z.string().nullable(),
    lane_no: z.number().int().min(1).max(6),
    racer_id: z.string(),
  })).min(1),
  combination: z.string().regex(/^[1-6]-[1-6]-[1-6]$/),
  payout_per_100_yen: z.number().int().nonnegative(),
  weather: z.string().optional(),
  wind_direction: z.string().optional(),
  wind_speed_m: z.number().int().nonnegative().optional(),
  wave_height_cm: z.number().int().nonnegative().optional(),
});

const edgeCandidateSchema = z.object({
  edge_id: z.string().regex(/^edge_[a-f0-9]{24}$/),
  race_id: z.string().regex(/^BR:\d{8}:\d{2}:\d{2}$/),
  race_date: isoDate,
  venue_name: z.string().min(1).max(20),
  venue_code: z.string().regex(/^\d{2}$/),
  race_no: z.number().int().min(1).max(12),
  start_at: z.string().datetime({ offset: true }),
  combination: z.string().regex(/^[1-6]-[1-6]-[1-6]$/),
  predicted_probability: z.number().positive().max(1),
  odds_decimal: z.number().positive().max(100000),
  expected_value_percent: z.number().nonnegative().max(100000),
  threshold_percent: z.number().min(100).max(1000),
  observed_at: z.string().datetime({ offset: true }),
  status: z.enum(["open", "settled", "excluded"]).default("open"),
});

const artifactSchema = z.object({
  kind: z.enum(["B", "K", "race_cards", "title", "tkz", "stt", "sui", "results", "payouts"]),
  date: isoDate,
  url: z.string().url(),
  fetched_at: z.string().datetime({ offset: true }),
  content_sha256: sha,
  byte_length: z.number().int().positive(),
});

export const ingestPayloadSchema = z.object({
  schema_version: z.literal("boat-race-edge-ingest/v1"),
  generated_at: z.string().datetime({ offset: true }),
  service_date: isoDate,
  summary: z.object({
    scheduled_races: z.number().int().min(0).max(288),
    predicted_races: z.number().int().min(0).max(288),
    incomplete_races: z.number().int().min(0).max(288),
  }).optional(),
  artifacts: z.array(artifactSchema).min(1).max(8),
  races: z.array(raceSchema).max(288),
  decisions: z.array(z.object({
    race_id: z.string(),
    model_version: z.enum(["poc-score-v0.1", "W_dynamic10_v1", "W_morning_badge_v1"]).optional(),
    score: z.number().int().min(0).max(100),
    decision: z.enum(["recommend", "skip"]),
    reasons: z.array(z.string().min(1).max(200)).min(1).max(8),
  })).max(288),
  predictions: z.array(predictionSchema).max(10),
  reassessments: z.array(reassessmentSchema).max(10).default([]),
  edge_candidates: z.array(edgeCandidateSchema).max(2304).default([]),
  results: z.array(resultSchema).max(288),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
