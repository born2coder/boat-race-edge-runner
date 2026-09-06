from __future__ import annotations

import unittest
from pathlib import Path

import pandas as pd

from scripts.edge_shadow import _candidate_rows, _eligible, parse_odds_html


class EdgeShadowTests(unittest.TestCase):
    def test_official_live_page_parses_all_120_combinations(self):
        fixture = Path(__file__).parent / "fixtures" / "odds3t.html"
        if not fixture.exists():
            self.skipTest("captured official fixture is not stored")
        odds, update = parse_odds_html(fixture.read_text(encoding="utf-8"))
        self.assertEqual(len(odds), 120)
        self.assertIsNotNone(update)

    def test_window_is_25_through_17_minutes_and_only_once(self):
        now = pd.Timestamp("2026-09-06T10:00:00Z")
        schedule = pd.DataFrame({
            "race_id": ["too_early", "open", "edge", "late", "done"],
            "deadline_at": [
                "2026-09-06T10:25:01Z", "2026-09-06T10:25:00Z", "2026-09-06T10:17:00Z",
                "2026-09-06T10:16:59Z", "2026-09-06T10:20:00Z",
            ],
        })
        self.assertEqual(_eligible(schedule, {"done"}, now).race_id.tolist(), ["open", "edge"])

    def test_records_and_opens_150_during_verification(self):
        prediction = {f"top{i}_combo": f"1-2-{3 + (i % 4)}" for i in range(1, 9)}
        prediction.update({f"top{i}_score": 0.10 if i == 1 else 0.01 for i in range(1, 9)})
        prediction["top1_combo"] = "1-2-3"
        race = {"race_id": "BR:20260906:11:01", "race_date": "2026-09-06", "venue": "びわこ", "venue_code": "11", "race_no": 1, "start_at": "2026-09-06T10:35:00+09:00"}
        odds = {prediction[f"top{i}_combo"]: 14.0 for i in range(1, 9)}
        odds["1-2-3"] = 15.0
        rows = _candidate_rows(prediction, race, odds, "2026-09-06T01:15:00+00:00")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["expected_value_percent"], 150.0)
        self.assertEqual(rows[0]["threshold_percent"], 150.0)
        self.assertEqual(rows[0]["status"], "open")

    def test_retry_keeps_the_same_candidate_id(self):
        prediction = {f"top{i}_combo": f"1-2-{3 + (i % 4)}" for i in range(1, 9)}
        prediction.update({f"top{i}_score": 0.01 for i in range(1, 9)})
        prediction["top1_combo"] = "1-2-3"
        prediction["top1_score"] = 0.10
        race = {"race_id": "BR:20260906:11:01", "race_date": "2026-09-06", "venue": "びわこ", "venue_code": "11", "race_no": 1, "start_at": "2026-09-06T10:35:00+09:00"}
        odds = {prediction[f"top{i}_combo"]: 10.0 for i in range(1, 9)}
        odds["1-2-3"] = 20.0
        first = _candidate_rows(prediction, race, odds, "2026-09-06T01:15:00+00:00")
        retry = _candidate_rows(prediction, race, odds, "2026-09-06T01:18:00+00:00")
        self.assertEqual(first[0]["edge_id"], retry[0]["edge_id"])


if __name__ == "__main__":
    unittest.main()
