type Assessment = { prediction_id: string; race_id: string; observed_at: string };
type PublishedPrediction = {
  prediction_id: string; race_id: string; publication_mode: string;
  published_at: string; official_performance_eligible: boolean;
  race: { start_at: string } | Array<{ start_at: string }>;
};

export function canPublishReassessment(assessment: Assessment, prediction: PublishedPrediction | undefined, now: number) {
  if (!prediction || prediction.prediction_id !== assessment.prediction_id || prediction.race_id !== assessment.race_id
    || prediction.publication_mode !== "morning_fixed_hit_v1" || !prediction.official_performance_eligible) return false;
  const race = Array.isArray(prediction.race) ? prediction.race[0] : prediction.race;
  const cutoff = Date.parse(race?.start_at) - 300_000;
  const published = Date.parse(prediction.published_at);
  const observed = Date.parse(assessment.observed_at);
  return Number.isFinite(cutoff) && Number.isFinite(published) && Number.isFinite(observed)
    && published <= now && published < cutoff && observed <= now && observed < cutoff && now < cutoff;
}
