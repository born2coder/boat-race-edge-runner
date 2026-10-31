import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import edge_calibration as cal, calibration_strategy as strategy
from tests.test_edge_calibration import day, race


class StrategyTests(unittest.TestCase):
    def test_factorial_separates_probability_and_coefficient(self):
        actual = strategy.factorial_selections([.06, .08, .009], [.08, .04, .5], [20, 20, 20])
        self.assertEqual(actual, {"raw080": [False, True, False], "raw100": [True, True, False],
                                  "calibrated080": [True, False, False], "calibrated100": [True, False, False]})
        same = strategy.factorial_selections([.1], [.1], [15])
        self.assertEqual(same["raw080"], same["calibrated080"])
        self.assertEqual(same["raw100"], same["calibrated100"])
        for values in strategy.factorial_selections([.1], [.1], [20], ready=False).values():
            self.assertEqual(values, [None])

    def test_factorial_does_not_require_closing_odds_and_keeps_common_support(self):
        days = [day(i) for i in range(1, 11)]
        for d in days:
            race(d).pop("final")
        with patch.object(cal, "MIN_RACES", 1):
            report = cal.build_report(days, "2026-10-12", "model-a")
        phase = report["phases"]["t10"]
        self.assertFalse(phase["trainReady"])
        self.assertTrue(phase["probabilityTrainReady"])
        for policy in phase["factorialComparison"]["all"].values():
            self.assertEqual(policy["supportedTickets"], 360)
            self.assertEqual(policy["unsupportedTickets"], 0)
        shadow = cal.shadow_snapshot(race(day(12))["snapshots"]["t10"], report)
        self.assertEqual(shadow["factorialExperimentId"], strategy.FACTORIAL_EXPERIMENT)
        self.assertFalse(shadow["purchaseEnabled"])
        self.assertIsNone(shadow["lowerFinalOdds"][0])
        self.assertTrue(shadow["factorialDecisions"]["raw080"][0])
        self.assertTrue(all(v is None for v in shadow["decisions"]["baseline"]))

    def test_factorial_forward_never_replays_old_or_late_decisions(self):
        d = day()
        legacy = {"experimentId": strategy.EXPERIMENT,
                  "decisions": {k: [True] + [False] * 119 for k in strategy.VARIANTS},
                  "recordedAt": "2026-10-01T00:50:01Z"}
        race(d)["calibration_shadow"] = {"snapshot-1": legacy}
        def result():
            rows, _ = cal.examples([d], "2026-10-12", "model-a")
            return strategy.factorial_forward(rows)["t10"]
        self.assertEqual(result()["recordedRaces"], 0)
        legacy.update(factorialExperimentId=strategy.FACTORIAL_EXPERIMENT,
                      factorialDecisions={k: [True] + [False] * 119 for k in strategy.FACTORIAL_VARIANTS})
        scored = result()
        self.assertEqual(scored["recordedRaces"], 1)
        self.assertEqual(scored["all"]["raw080"]["payout"], 5000)
        race(d)["final"] = None  # Actual payout is sufficient; final grid is unrelated.
        self.assertEqual(result(), scored)
        legacy["factorialDecisions"]["raw100"][0] = None
        self.assertEqual(result()["recordedRaces"], 0)
        legacy["factorialDecisions"]["raw100"][0] = True
        legacy["recordedAt"] = "2026-10-01T01:20:00Z"
        self.assertEqual(result()["recordedRaces"], 0)

    def test_factorial_boundaries_actual_payout_and_no_data(self):
        row = {"date":"2026-10-01", "race_id":"r", "odds":[19.9,20], "winner":0,"payout":1000}
        choices = {k:[True,True] for k in strategy.FACTORIAL_VARIANTS}
        result = strategy.summarize([row], [choices], 20, strategy.FACTORIAL_VARIANTS)
        for p in result.values():
            self.assertEqual((p["tickets"], p["payout"], p["supportedTickets"]), (1, 1000, 1))
        report = cal.build_report([], "2026-10-12", "model-a")
        for phase in report["phases"].values():
            self.assertFalse(phase["probabilityTrainReady"])
            self.assertTrue(all(p["roi"] is None for p in phase["factorialComparison"]["all"].values()))

    def test_band_fit_preserves_rank_mass_and_does_not_mutate_model(self):
        rows, _ = cal.examples([day(i, i % 3) for i in range(1, 11)], "2026-10-12", "model-a")
        original = copy.deepcopy(rows)
        points = strategy.fit_probability(rows)
        self.assertEqual(rows, original)
        values = [i / 7140 for i in range(120)]
        result = strategy.calibrate(values, points)
        self.assertAlmostEqual(sum(result), 1)
        self.assertEqual(sorted(result), result)
        self.assertTrue(all(0 < v < 1 for v in result))

    def test_no_test_labels_enter_fit(self):
        days = [day(i) for i in range(1, 11)]
        first = cal.build_report(days, "2026-10-12", "model-a")
        for d in days[-3:]:
            race(d)["result"]["combination"] = sorted(cal.COMBOS)[1]
        second = cal.build_report(days, "2026-10-12", "model-a")
        self.assertEqual(first["phases"]["t10"]["probabilityCells"], second["phases"]["t10"]["probabilityCells"])

    def test_minimum_probability_and_unknown_are_shared(self):
        output = strategy.selections([.009, .01, .1], [.1, .1, .1], [1000, 200, 20], [900, 150, None])
        for values in output.values():
            self.assertEqual(values, [False, True, None])
        self.assertEqual(strategy.selections([.1], [.1], [20], [20], ready=False)["baseline"], [None])

    def test_odds_under20_is_strict_and_uses_observed_price(self):
        row = {"date":"2026-10-01", "race_id":"r", "odds":[19.9,20], "winner":0,"payout":1000}
        choices = {k:[True,True] for k in strategy.VARIANTS}
        result = strategy.summarize([row], [choices], 20)
        self.assertEqual(result["baseline"]["tickets"], 1)
        self.assertEqual(result["baseline"]["payout"], 1000)

    def test_payout_is_actual_not_estimated_and_daily_risk(self):
        rows = [{"date":f"2026-10-0{i}","race_id":str(i),"odds":[100],"winner":0 if i==1 else 1,"payout":500} for i in range(1,4)]
        decision={k:[True] for k in strategy.VARIANTS}
        result=strategy.summarize(rows,[decision]*3)["baseline"]
        self.assertEqual(result["payout"],500)
        self.assertEqual(result["maxDailyDrawdown"],200)
        self.assertEqual(result["top5PayoutShare"],1)
        self.assertAlmostEqual(result["roi"],500/300)

    def test_forward_requires_frozen_valid_new_experiment(self):
        d=day()
        rows,_=cal.examples([d],"2026-10-12","model-a")
        self.assertEqual(strategy.frozen_forward(rows)["t10"]["recordedRaces"],0)
        decisions={k:[True]+[False]*119 for k in strategy.VARIANTS}
        race(d)["calibration_shadow"]={"snapshot-1":{"experimentId":strategy.EXPERIMENT,"decisions":decisions,"recordedAt":"2026-10-01T00:50:01Z"}}
        rows,_=cal.examples([d],"2026-10-12","model-a")
        result=strategy.frozen_forward(rows)["t10"]
        self.assertEqual(result["all"]["baseline"]["tickets"],1)
        self.assertEqual(result["all"]["baseline"]["payout"],5000)
        race(d)["calibration_shadow"]["snapshot-1"]["recordedAt"]="2026-10-01T01:20:00Z"
        rows,_=cal.examples([d],"2026-10-12","model-a")
        self.assertEqual(strategy.frozen_forward(rows)["t10"]["recordedRaces"],0)

    def test_versioned_artifacts_keep_v1_and_freeze_v2(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); (root/"calibration").mkdir()
            old=root/"calibration/2026-10-12.json";old.write_text('{"version":"v1"}')
            v2=root/"calibration/edge-calibration-v2/2026-10-12.json"
            v2.parent.mkdir();v2.write_text('{"version":"edge-calibration-v2"}')
            first=cal.daily_report(root,"2026-10-12","model-a")
            second=cal.daily_report(root,"2026-10-12","model-a")
            self.assertEqual(first,second)
            self.assertEqual(old.read_text(),'{"version":"v1"}')
            self.assertEqual(v2.read_text(),'{"version":"edge-calibration-v2"}')
            self.assertTrue((root/"calibration"/cal.VERSION/"2026-10-12.json").exists())
            self.assertFalse(any(v["recordedRaces"] for v in first["forwardComparison"].values()))

    def test_timing_uses_shared_races_and_supported_combinations(self):
        days=[day(i) for i in range(1,11)]
        for d in days:
            rr=race(d)
            for phase in ("t15","t5"):
                ss=copy.deepcopy(rr["snapshots"]["t10"]);ss["phase"]=phase;ss["snapshot_id"]+=phase
                rr["snapshots"][phase]=ss;rr["receipts"][ss["snapshot_id"]]=d["date"]+"T00:50:02Z"
                d["forward_observations_sent"].append(ss["snapshot_id"])
        race(days[-1])["snapshots"].pop("t5")
        with patch.object(cal,"MIN_RACES",1):
            report=cal.build_report(days,"2026-10-12","model-a")
        self.assertEqual(report["matchedTiming"]["races"],2)
        for group in report["matchedTiming"]["phases"].values():
            self.assertEqual(group["all"]["baseline"]["supportedTickets"],240)
            self.assertEqual(group["all"]["baseline"]["evaluatedRaces"],2)

if __name__=="__main__": unittest.main()
