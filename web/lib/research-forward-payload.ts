import { z } from "zod";
import { MODEL_VERSION } from "./four-page";
const instant = z.string().datetime({ offset: true });
const vector = z.array(z.number().finite()).length(120);
const snapshot = z.object({
  snapshot_id: z.string().min(1).max(160), version: z.literal(MODEL_VERSION),
  phase: z.enum(["t30", "t20", "t15", "t10", "t5"]),
  observed_at: instant, computed_at: instant, request_started_at: instant,
  official_update_time: z.string(), minutes_before: z.number().finite(),
  combinations: z.array(z.string().regex(/^[1-6]-[1-6]-[1-6]$/)).length(120),
  odds: vector, morning: vector, exhibition: vector.nullable(),
  exhibition_source_ready_at: instant.nullable(),
});
const raceId = z.string().regex(/^BR:\d{8}:\d{2}:\d{2}$/);
export const forwardPayload = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observations: z.array(z.object({
    race_id: raceId, race_date: z.string(), venue_code: z.string(), venue: z.string(),
    race_no: z.number().int(), start_at: instant,
    snapshot, receipt: instant,
  })).max(24),
  results: z.array(z.object({
    raceId,
    result: z.object({
      cancelled: z.boolean(), refundedLanes: z.array(z.number().int().min(1).max(6)).max(6),
      combination: z.string().regex(/^[1-6]-[1-6]-[1-6]$/).nullable(),
      payoutPer100Yen: z.number().int().nonnegative().nullable(),
      unsupported: z.boolean(), confirmedAt: instant,
    }),
  })).max(24),
  progress: z.object({
    ended: z.number().int().min(0).max(288), remaining: z.number().int().min(0).max(288),
    confirming: z.number().int().min(0).max(288), cancelled: z.number().int().min(0).max(288),
  }),
});
