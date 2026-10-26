import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import edge_calibration as cal, calibration_strategy as strategy
from tests.test_edge_calibration import day, race


class StrategyTests(unittest.TestCase):
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
            first=cal.daily_report(root,"2026-10-12","model-a")
            second=cal.daily_report(root,"2026-10-12","model-a")
            self.assertEqual(first,second)
            self.assertEqual(old.read_text(),'{"version":"v1"}')
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
