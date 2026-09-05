import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/reassessment-safety.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { canPublishReassessment } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const prediction = { prediction_id: "p", race_id: "r", publication_mode: "morning_fixed_hit_v1", published_at: "2026-09-05T08:00:00+09:00", official_performance_eligible: true, race: { start_at: "2026-09-05T13:58:00+09:00" } };
const assessment = { prediction_id: "p", race_id: "r", observed_at: "2026-09-05T13:48:24+09:00" };
const time = (value) => Date.parse(`2026-09-05T${value}+09:00`);

test("badge must arrive before the safety cutoff, including on retries", () => {
  assert.equal(canPublishReassessment(assessment, prediction, time("13:50:00")), true);
  assert.equal(canPublishReassessment(assessment, { ...prediction, race: [prediction.race] }, time("13:50:00")), true);
  for (const value of ["13:53:00", "13:57:00", "14:10:00"]) {
    assert.equal(canPublishReassessment(assessment, prediction, time(value)), false);
  }
});

test("missing identity, ineligible predictions, future timestamps and invalid dates fail closed", () => {
  for (const p of [undefined, { ...prediction, race_id: "other" }, { ...prediction, prediction_id: "other" }, { ...prediction, official_performance_eligible: false }, { ...prediction, publication_mode: "historical_replay" }, { ...prediction, race: [] }, { ...prediction, published_at: "invalid" }, { ...prediction, published_at: "2026-09-05T13:55:00+09:00" }]) {
    assert.equal(canPublishReassessment(assessment, p, time("13:50:00")), false);
  }
  assert.equal(canPublishReassessment(assessment, prediction, time("13:48:00")), false);
  assert.equal(canPublishReassessment({ ...assessment, observed_at: "invalid" }, prediction, time("13:50:00")), false);
});
