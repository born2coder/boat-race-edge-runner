import "server-only";
import { z } from "zod";
import { getEdgeV2Revision } from "@/db/edge-v2-repository";

const metric = z.number().finite();
const probability = z.object({
  races: metric, logLoss: metric, brier: metric,
  reliability: z.array(z.object({ upper: metric, tickets: metric, predicted: metric, actual: metric })),
}).nullable();
const policy = z.object({ tickets: metric, hits: metric, stake: metric, payout: metric, roi: metric.nullable(),
  supportedTickets: metric.optional(), unsupportedTickets: metric.optional(), evaluatedRaces: metric.optional(),
  maxDailyDrawdown: metric.optional(), top5PayoutShare: metric.nullable().optional(),
  daily: z.array(z.object({date: z.string(), tickets: metric, hits: metric, stake: metric, payout: metric, net: metric, roi: metric})).optional(),
});
const comparison = z.object({ baseline: policy, probability: policy.optional(), adjusted: policy });
const group = z.object({ all: comparison, under20: comparison });
const factorial = z.object({raw080: policy, raw100: policy, calibrated080: policy, calibrated100: policy});
const factorialGroup = z.object({all: factorial, under20: factorial});
export const calibrationSchema = z.object({
  version: z.enum(["edge-calibration-v1", "edge-calibration-v2", "edge-calibration-v3"]), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  artifactId: z.string(), mode: z.literal("shadow"), modelSha: z.string(),
  trainDates: z.array(z.string()), testDates: z.array(z.string()),
  minTrainDays: metric, minTestDays: metric, minRaces: metric,
  phases: z.record(z.object({
    trainRaces: metric, testRaces: metric, finalGridTrainRaces: metric, finalGridTestRaces: metric,
    temperature: metric, status: z.enum(["collecting", "validation_failed", "review_ready"]),
    probabilityPass: z.boolean(), oddsPass: z.boolean(),
    rawProbability: probability, adjustedProbability: probability,
    oddsValidation: z.object({ races: metric, tickets: metric,
      rawLogError: metric.nullable(), adjustedLogError: metric.nullable(), belowLowerRate: metric.nullable() }),
    policyComparison: comparison, under20Comparison: comparison.optional(),
    factorialComparison: factorialGroup.optional(),
  })),
  experimentId: z.string().optional(),
  matchedTiming: z.object({races: metric, phases: z.record(group)}).optional(),
  forwardComparison: z.record(group.extend({recordedRaces: metric})).optional(),
  factorialExperimentId: z.string().optional(),
  factorialForwardComparison: z.record(factorialGroup.extend({recordedRaces: metric})).optional(),
});
export async function loadCalibration() {
  const revision = await getEdgeV2Revision();
  if (!revision) return null;
  try {
    const response = await fetch(`https://raw.githubusercontent.com/born2coder/boat-race-edge-runner/${revision}/state/edge_v2/calibration/latest.json`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return calibrationSchema.parse(await response.json());
  } catch { return null; }
}

