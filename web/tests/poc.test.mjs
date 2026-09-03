import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixture = JSON.parse(await readFile(new URL("../lib/data/fixture.json", import.meta.url), "utf8"));

test("one completed race day joins every program and result", () => {
  assert.equal(fixture.replay_day.race_count, 168);
  assert.equal(fixture.replay_day.result_count, 168);
  assert.equal(fixture.replay_day.entry_count, 1008);
  assert.equal(fixture.replay_day.decisions.length, 168);
});

test("every published virtual plan has explicit 100-yen-unit tickets", () => {
  const predictions = [...fixture.current_day.predictions, ...fixture.replay_day.predictions];
  for (const prediction of predictions) {
    assert.equal(prediction.tickets.reduce((sum, ticket) => sum + ticket.stake_yen, 0), prediction.virtual_stake_yen);
    assert.equal(new Set(prediction.tickets.map((ticket) => ticket.combination)).size, prediction.tickets.length);
    for (const ticket of prediction.tickets) assert.equal(ticket.stake_yen % 100, 0);
  }
});

test("settlement ledger reconciles to zero yen difference", () => {
  const settlements = fixture.replay_day.predictions.map((prediction) => prediction.result.settlement);
  for (const settlement of settlements) {
    assert.equal(settlement.lines.reduce((sum, line) => sum + line.stake_yen, 0), settlement.original_stake_yen);
    assert.equal(settlement.lines.reduce((sum, line) => sum + line.return_yen, 0), settlement.gross_return_yen);
    assert.equal(settlement.gross_return_yen + settlement.refund_yen - settlement.original_stake_yen, settlement.profit_yen);
  }
  assert.equal(settlements.reduce((sum, row) => sum + row.original_stake_yen, 0), fixture.replay_day.stats.total_stake_yen);
  assert.equal(settlements.reduce((sum, row) => sum + row.gross_return_yen, 0), fixture.replay_day.stats.total_return_yen);
});

test("no-recommendation is only emitted for complete coverage", () => {
  assert.equal(fixture.current_day.status, "complete");
  assert.equal(fixture.current_day.coverage_percent, 100);
  assert.equal(fixture.current_day.incomplete_count, 0);
  assert.equal(
    fixture.current_day.analyzed_count,
    fixture.current_day.recommended_count + fixture.current_day.skipped_count,
  );
});

test("today venue board covers every venue and only exposes target races", () => {
  assert.equal(fixture.current_day.venues.length, fixture.current_day.venue_count);
  assert.equal(
    fixture.current_day.venues.reduce((sum, venue) => sum + venue.race_count, 0),
    fixture.current_day.analyzed_count,
  );
  const boardTargets = fixture.current_day.venues.flatMap((venue) => venue.target_races);
  assert.equal(boardTargets.length, fixture.current_day.recommended_count);
  assert.deepEqual(
    new Set(boardTargets.map((race) => race.prediction_id)),
    new Set(fixture.current_day.predictions.map((prediction) => prediction.prediction_id)),
  );
});

test("all publication hashes and source checksums are sha-256", () => {
  for (const artifact of fixture.artifacts) assert.match(artifact.content_sha256, /^[a-f0-9]{64}$/);
  for (const prediction of [...fixture.current_day.predictions, ...fixture.replay_day.predictions]) {
    assert.match(prediction.publication_hash, /^[a-f0-9]{64}$/);
    assert.equal(prediction.official_performance_eligible, false);
  }
});
