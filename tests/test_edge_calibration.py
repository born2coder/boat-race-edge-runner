import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts import edge_calibration as cal

COMBOS = sorted(cal.COMBOS)


def day(number=1, winner=0):
    date = f"2026-10-{number:02d}"
    rid = f"BR:202610{number:02d}:01:01"
    sid = f"snapshot-{number}"
    snapshot = {"snapshot_id": sid, "phase": "t10", "model_bundle_sha256": "model-a",
                "observed_at": date + "T00:50:00Z", "computed_at": date + "T00:50:01Z",
                "exhibition_source_ready_at": date + "T00:45:00Z", "close_at": date + "T01:00:00Z",
                "combinations": COMBOS, "exhibition": [.2] + [.8 / 119] * 119, "odds": [100.] * 120}
    race = {"race_id": rid, "start_at": date + "T01:00:00Z", "snapshots": {"t10": snapshot},
            "receipts": {sid: date + "T00:50:02Z"},
            "result": {"combination": COMBOS[winner], "payout_per_100_yen": 5000,
                       "evidence": {"obtained_at": date + "T01:20:00Z"}},
            "final": {"validation": "official-result-payout-match", "race_identity_verified": rid,
                      "observed_at": date + "T01:21:00Z", "odds": dict.fromkeys(COMBOS, 50.)}}
    return {"date": date, "races": {rid: race}, "forward_observations_sent": [sid]}


def race(d):
    return next(iter(d["races"].values()))


class CalibrationTests(unittest.TestCase):
    def test_only_forward_complete_vectors_once_per_race_phase(self):
        d = day()
        rows, _ = cal.examples([d, copy.deepcopy(d)], "2026-10-12", "model-a")
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rows[0]["final"]), 120)
        d["forward_observations_ignored"] = d["forward_observations_sent"]
        self.assertEqual(cal.examples([d], "2026-10-12", "model-a")[0], [])

    def test_missing_result_refunds_model_mismatch_and_future_receipt_excluded(self):
        for mutate in (lambda d: race(d).pop("result"),
                       lambda d: race(d)["result"].update(refunded_lanes=[1]),
                       lambda d: race(d)["snapshots"]["t10"].update(model_bundle_sha256="other"),
                       lambda d: race(d)["receipts"].update({"snapshot-1": "2026-10-01T01:01:00Z"}),
                       lambda d: race(d)["result"]["evidence"].update(obtained_at="2026-10-12T00:00:00Z")):
            d = day()
            mutate(d)
            self.assertEqual(cal.examples([d], "2026-10-12", "model-a")[0], [])

    def test_corrupt_probability_vectors_are_not_training_data(self):
        for vector in ([float("nan")] * 120, [.1] * 120, [1 / 119] * 119, [True] * 120):
            d = day()
            race(d)["snapshots"]["t10"]["exhibition"] = vector
            self.assertFalse(cal.examples([d], "2026-10-12", "model-a")[0])

    def test_missing_or_wrong_final_grid_does_not_invent_odds(self):
        for mutate in (lambda d: race(d).pop("final"),
                       lambda d: race(d)["final"]["odds"].pop(COMBOS[-1]),
                       lambda d: race(d)["final"]["odds"].update({COMBOS[0]: 70.}),
                       lambda d: race(d)["final"].update(observed_at="2026-10-01T00:50:00Z")):
            d = day()
            mutate(d)
            rows, _ = cal.examples([d], "2026-10-12", "model-a")
            self.assertEqual(len(rows), 1)
            self.assertIsNone(rows[0]["final"])

    def test_future_and_current_days_never_enter_training(self):
        rows, _ = cal.examples([day(1), day(12), day(13)], "2026-10-12", "model-a")
        self.assertEqual([r["date"] for r in rows], ["2026-10-01"])

    def test_out_of_time_labels_cannot_change_fitted_parameters(self):
        days = [day(i) for i in range(1, 11)]
        first = cal.build_report(days, "2026-10-12", "model-a")
        for d in days[-3:]:
            race(d)["result"]["combination"] = COMBOS[1]
            race(d)["final"]["odds"] = dict.fromkeys(COMBOS, 500.)
            race(d)["result"]["payout_per_100_yen"] = 50000
        second = cal.build_report(days, "2026-10-12", "model-a")
        for key in ("temperature", "oddsCells"):
            self.assertEqual(first["phases"]["t10"][key], second["phases"]["t10"][key])
        self.assertNotEqual(first["phases"]["t10"]["adjustedProbability"], second["phases"]["t10"]["adjustedProbability"])
        self.assertFalse(set(first["trainDates"]) & set(first["testDates"]))

    def test_scaling_preserves_rank_and_probability_mass(self):
        original = [.2] + [.8 / 119] * 119
        for temperature in cal.TEMPERATURES:
            p = cal.scaled(original, temperature)
            self.assertAlmostEqual(sum(p), 1)
            self.assertGreater(p[0], max(p[1:]))
        self.assertEqual(original[0], .2)

    def test_empty_and_small_data_never_pass(self):
        for days in ([], [day(i) for i in range(1, 9)]):
            report = cal.build_report(days, "2026-10-12", "model-a")
            for phase in report["phases"].values():
                self.assertFalse(phase["probabilityPass"])
                self.assertFalse(phase["oddsPass"])
                self.assertEqual(phase["status"], "collecting")

    def test_unknown_odds_cell_blocks_ev_and_never_enables_purchase(self):
        report = cal.build_report([day(i) for i in range(1, 11)], "2026-10-12", "model-a")
        snapshot = race(day(12))["snapshots"]["t10"]
        shadow = cal.shadow_snapshot(snapshot, report)
        self.assertEqual(shadow["adjustedEv"], [None] * 120)
        self.assertFalse(shadow["purchaseEnabled"])
        report["asOf"] = "2026-10-11"
        self.assertIsNone(cal.shadow_snapshot(snapshot, report))

    def test_daily_artifact_is_frozen_on_restarts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "days").mkdir()
            report = cal.daily_report(root, "2026-10-12", "model-a")
            (root / "days/2026-10-01.json").write_text(json.dumps(day()))
            self.assertEqual(report, cal.daily_report(root, "2026-10-12", "model-a"))
            with self.assertRaises(ValueError):
                cal.daily_report(root, "2026-10-12", "other")

    def test_odds_fit_includes_losing_combinations(self):
        rows, _ = cal.examples([day()], "2026-10-12", "model-a")
        cells = cal.fit_odds(rows)
        self.assertEqual(cells["3"]["tickets"], 120)
        self.assertEqual(cells["3"]["meanRatio"], .5)
        self.assertEqual(cells["3"]["races"], 1)


class FinalGridBudgetTests(unittest.TestCase):
    def run_settle(self, overdue=0, failures=False, blocked=False):
        from scripts import edge_v2 as edge
        now = datetime(2026, 10, 1, 2, 0, tzinfo=timezone.utc)
        state = day()
        r = race(state)
        r.pop("final")
        r["roster"] = [1]
        if blocked:
            r["final_attempt_count"] = 3
        for i in range(overdue):
            state["races"][str(i)] = {"start_at": "2026-10-01T01:00:00Z", "roster": [1]}
        observer = edge.Observer.__new__(edge.Observer)
        observer.archive_checks = {"2026-10-01": 100}
        result = (dict.fromkeys(COMBOS, 50.), {"observed_at": now.isoformat()})
        with patch.dict("os.environ", {"EDGE_RESEARCH_FORWARD": "1"}), \
             patch.object(edge, "utcnow", return_value=now), \
             patch.object(edge.time, "monotonic", return_value=100), \
             patch.object(edge.edge_official, "fetch_result", side_effect=TimeoutError()) as settle_fetch, \
             patch.object(edge, "fetch_grid", side_effect=TimeoutError() if failures else None, return_value=result) as grid_fetch:
            observer.settle(state)
            return state, grid_fetch.call_count, settle_fetch.call_count

    def test_results_take_priority_with_no_increase_to_batch_limit(self):
        _, grids, results = self.run_settle(overdue=8)
        self.assertEqual((grids, results), (0, 8))

    def test_available_slot_collects_complete_grid(self):
        state, grids, results = self.run_settle(overdue=7)
        self.assertEqual((grids, results), (1, 7))
        self.assertEqual(len(race(state)["final"]["odds"]), 120)

    def test_failure_is_bounded_and_does_not_erase_result(self):
        state, grids, _ = self.run_settle(failures=True)
        self.assertEqual(grids, 1)
        self.assertEqual(race(state)["final_attempt_count"], 1)
        self.assertIn("result", race(state))
        self.assertIn("final_error", race(state))
        _, grids, _ = self.run_settle(blocked=True)
        self.assertEqual(grids, 0)


if __name__ == "__main__":
    unittest.main()
