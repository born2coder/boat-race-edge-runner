import "server-only";
import { z } from "zod";
import { getEdgeV2Revision } from "@/db/edge-v2-repository";

const metric = z.number().finite();
const probability = z.object({
  races: metric, logLoss: metric, brier: metric,
  reliability: z.array(z.object({ upper: metric, tickets: metric, predicted: metric, actual: metric })),
}).nullable();
const policy = z.object({ tickets: metric, hits: metric, stake: metric, payout: metric, roi: metric.nullable() });
export const calibrationSchema = z.object({
  version: z.literal("edge-calibration-v1"), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
    policyComparison: z.object({ baseline: policy, adjusted: policy }),
  })),
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
