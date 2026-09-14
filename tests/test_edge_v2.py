from __future__ import annotations

import copy
import math
import unittest
from datetime import datetime, timezone
from itertools import permutations
from types import SimpleNamespace

import numpy as np
import pandas as pd

from scripts.edge_v2 import capture, final_grid, phase_due, progress, raw_id
from scripts.edge_v2_metrics import picks, summarize, aggregate_days, comparison, snapshot_hash
from scripts.edge_v2_model import validate_distribution, predict_full

COMBOS = ["-".join(map(str, p)) for p in permutations(range(1, 7), 3)]


def fixture():
    probs = [0.01] * 8 + [0.009] + [(1 - .08 - .009) / 111] * 111
    odds = [10.] * 120
    odds[8] = 200.
    snap = {"snapshot_id": "s1", "phase": "t20", "observed_at": "2026-09-14T01:10:00+00:00",
            "combinations": COMBOS, "odds": odds, "morning": probs, "exhibition": probs.copy()}
    return {"race_id": "BR:20260914:01:01", "race_date": "2026-09-14", "start_at": "2026-09-14T01:30:00+00:00",
            "snapshots": {"t20": snap}, "receipts": {"s1": "2026-09-14T01:11:00+00:00"},
            "result": {"combination": COMBOS[8], "payout_per_100_yen": 10000, "refunded_lanes": []}}


class EdgeV2Tests(unittest.TestCase):
    def test_exhibition_rejects_future_source_and_reports_the_reason(self):
        probabilities = np.array([[1/120] * 120])
        model = SimpleNamespace(predict_trifecta=lambda frame: probabilities)
        def infer(frame, proxy):
            values = proxy.predict_trifecta(frame)[0]
            row = {"race_id": "example", "source_safe": True,
                   "source_ready_at": "2026-09-14T01:01:00Z", "safe_cutoff_at": "2026-09-14T01:20:00Z"}
            for rank in range(1, 9):
                row[f"top{rank}_combo"] = COMBOS[rank-1]
                row[f"top{rank}_score"] = values[rank-1]
            return pd.DataFrame([row])
        hybrid = SimpleNamespace(predict_exhibition=infer)
        module = SimpleNamespace(TRIPLES=np.array([[int(x)-1 for x in c.split('-')] for c in COMBOS]))
        frame = pd.DataFrame([{"race_id": "example"}]); reasons = {}
        self.assertEqual(predict_full(frame, model, hybrid, module, "exhibition", pd.Timestamp("2026-09-14T01:00:00Z"), reasons), {})
        self.assertEqual(reasons, {"example": "source_from_future"})
        self.assertIn("example", predict_full(frame, model, hybrid, module, "exhibition", pd.Timestamp("2026-09-14T01:02:00Z")))

    def test_probability_score_includes_unselected_races_and_excludes_refunds(self):
        race = fixture()
        row = summarize([race], "t20", "morning", 300, paired=True)
        self.assertEqual(row["points"], 0)
        self.assertEqual(row["scored_races"], 1)
        self.assertAlmostEqual(row["log_loss_sum"], -math.log(.009))
        race["result"]["refunded_lanes"] = [6]
        self.assertEqual(summarize([race], "t20", "morning", 150)["scored_races"], 0)

    def test_ninth_rank_is_evaluated_and_scope_partition_reconciles(self):
        race = fixture()
        self.assertEqual(picks(race["snapshots"]["t20"], "morning")[0]["rank"], 9)
        values = [summarize([race], "t20", "morning", 150, scope) for scope in ("all120", "top8", "rank9plus")]
        self.assertEqual([v["points"] for v in values], [1, 0, 1])
        self.assertEqual(values[0]["payout_yen"], 10000)
        self.assertEqual(values[0]["return_rate"], 10000)

    def test_120_probability_mass_and_distinct_combinations(self):
        validate_distribution(fixture()["snapshots"]["t20"]["morning"], COMBOS)
        for vals, combos in [([.01]*120, COMBOS), ([float("nan")]*120, COMBOS), ([1/120]*120, COMBOS[:119]+[COMBOS[0]])]:
            with self.assertRaises(ValueError): validate_distribution(vals, combos)

    def test_no_receipt_or_late_receipt_never_enters_forward_results(self):
        for receipt in [None, "2026-09-14T01:30:00+00:00", "2026-09-14T01:31:00+00:00", "2026-09-14T01:09:00+00:00"]:
            race = fixture();race["receipts"] = {"s1": receipt} if receipt else {}
            self.assertEqual(summarize([race], "t20", "morning", 150)["points"], 0)

    def test_pending_and_refund_are_separate_from_losses(self):
        race = fixture();race.pop("result")
        row = summarize([race], "t20", "morning", 150)
        self.assertEqual(row["pending_points"], 1);self.assertIsNone(row["return_rate"])
        race = fixture();race["result"]["refunded_lanes"] = [int(COMBOS[8][0])]
        row = summarize([race], "t20", "morning", 150)
        self.assertEqual(row["refunded_points"], 1);self.assertEqual(row["stake_yen"], 0)

    def test_exhibition_comparison_uses_common_races_only(self):
        one, two = fixture(), fixture();two["snapshots"]["t20"]["exhibition"] = None
        self.assertEqual(summarize([one, two], "t20", "morning", 150, paired=True)["points"], 1)
        self.assertEqual(summarize([one, two], "t20", "exhibition", 150, paired=True)["points"], 1)
        self.assertEqual(summarize([one, two], "t20", "morning", 150)["points"], 2)

    def test_aggregate_sums_stakes_not_unweighted_daily_roi(self):
        one = fixture();two = fixture();two["result"]["combination"] = COMBOS[0]
        a = comparison([one]);b = comparison([two,two,two])
        row = next(r for r in aggregate_days([{"comparison": a},{"comparison": b}]) if r["phase"]=="t20" and r["model"]=="morning" and r["scope"]=="all120" and r["threshold"]==150 and not r["paired"])
        self.assertEqual(row["stake_yen"], 400);self.assertEqual(row["return_rate"], 2500)

    def test_id_normalization_and_followups_do_not_require_initial_candidate(self):
        self.assertEqual(raw_id("BR:20260914:01:01"), "202609140101")
        race = fixture()
        self.assertEqual(phase_due(race, datetime.fromisoformat("2026-09-14T01:15:00+00:00")), "t15")
        race["snapshots"] = {}
        self.assertEqual(phase_due(race, datetime.fromisoformat("2026-09-14T01:20:00+00:00")), "t10")
        self.assertIsNone(phase_due(race, datetime.fromisoformat("2026-09-14T01:23:00+00:00")))

    def test_initial_snapshot_survives_later_odds_and_retry(self):
        race = fixture();race["snapshots"] = {}
        model = {"combinations":COMBOS,"probabilities":fixture()["snapshots"]["t20"]["morning"],"source_ready_at":None}
        grid = ({c:200. for c in COMBOS},{"observed_at":"2026-09-14T01:10:00+00:00","official_update_time":"10:10"})
        first = capture(race,"t20",grid,{"morning":model},"2026-09-14T01:09:59+00:00")
        changed = copy.deepcopy(grid);changed[0][COMBOS[8]]=10.
        capture(race,"t20",changed,{"morning":model},"2026-09-14T01:09:59+00:00")
        self.assertEqual(race["snapshots"]["t20"]["snapshot_id"],first["snapshot_id"])
        self.assertEqual(race["snapshots"]["t20"]["odds"][8],200.)

    def test_official_single_digit_morning_hour_is_accepted(self):
        model = {"combinations": COMBOS, "probabilities": [1/120]*120}
        for hour in (8, 9, 10):
            for label in (f"{hour}:18", f"{hour:02d}:18"):
                race = fixture(); race["snapshots"] = {}
                race["start_at"] = f"2026-09-14T{hour:02d}:38:00+09:00"
                observed = f"2026-09-14T{hour:02d}:18:20+09:00"
                snap = capture(race, "t20", ({c:200. for c in COMBOS},
                    {"observed_at": observed, "official_update_time": label}), {"morning": model}, observed)
                self.assertEqual(len(snap["odds"]), 120)

    def test_late_or_stale_odds_not_backdated_into_window(self):
        race=fixture();model={"combinations":COMBOS,"probabilities":[1/120]*120}
        for observed, official in [("2026-09-14T01:31:00+00:00","10:30"),("2026-09-14T01:10:00+00:00","09:50")]:
            with self.assertRaises(ValueError):capture(race,"t20",({c:10. for c in COMBOS},{"observed_at":observed,"official_update_time":official}),{"morning":model},observed)

    def test_final_grid_requires_result_and_winning_payout_match(self):
        race=fixture();grid=({c:10. for c in COMBOS},{"observed_at":"2026-09-14T01:40:00+00:00"})
        with self.assertRaises(ValueError):final_grid(race,grid)
        grid[0][COMBOS[8]]=100.
        final_grid(race,grid);self.assertEqual(len(race["final"]["odds"]),120)

    def test_missing_observation_is_not_zero_candidates(self):
        race=fixture();race["snapshots"]={}
        p=progress({"races":{"id":race}},datetime.fromisoformat("2026-09-14T01:31:00+00:00"))
        self.assertEqual(p["checked"],0);self.assertEqual(p["missed"],{"t20":1,"t15":1,"t10":1})


if __name__ == "__main__": unittest.main()
