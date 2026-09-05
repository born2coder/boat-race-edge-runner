import type { Prediction } from "@/lib/poc";

export function racePhase(prediction: Pick<Prediction, "race" | "result">, now = Date.now()) {
  if (prediction.result) return "settled";
  const deadline = Date.parse(prediction.race.start_at);
  return Number.isFinite(deadline) && deadline > now ? "upcoming" : "pending";
}

export function officialResultUrl(raceId: string) {
  const match = /^BR:(\d{8}):(\d{2}):(\d{2})$/.exec(raceId);
  if (!match || +match[2] < 1 || +match[2] > 24 || +match[3] < 1 || +match[3] > 12) return null;
  return `https://www.boatrace.jp/owpc/pc/race/raceresult?hd=${match[1]}&jcd=${match[2]}&rno=${+match[3]}`;
}
