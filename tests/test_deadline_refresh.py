import copy
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from scripts import edge_v2, prepare_forward
from scripts.edge_v2_metrics import public_eligible, snapshot_deadline


class DeadlineRefreshTests(unittest.TestCase):
    def setUp(self):
        self.observer = edge_v2.Observer(Path("unused"))
        self.race = {"race_id": "BR:20261009:23:04", "race_date": "2026-10-09",
                     "venue_code": "23", "race_no": 4, "start_time_jst": "10:05",
                     "start_at": "2026-10-09T10:05:00+09:00", "snapshots": {}, "receipts": {}}
        self.bundle = {"deadlines": {4: "10:14"}, "evidence": {
            "obtained_at": "2026-10-09T09:30:00+09:00", "sha256": "fixture", "url": "fixture"}}

    def test_karatsu_delay_moves_window_without_consuming_or_rewriting_phase(self):
        now = datetime.fromisoformat("2026-10-09T09:58:00+09:00")
        self.assertEqual(edge_v2.phase_due(self.race, now), "t5")
        self.observer.apply_schedule(self.race, self.bundle, {"race": self.race})
        self.assertEqual(edge_v2.phase_due(self.race, now), "t15")
        self.assertEqual(edge_v2.phase_due(self.race, datetime.fromisoformat("2026-10-09T10:08:00+09:00")), "t5")
        self.assertEqual(self.race["snapshots"], {})
        self.assertEqual(len(self.race["deadline_changes"]), 1)

    def test_old_snapshot_and_its_publication_boundary_never_change(self):
        snapshot = {"snapshot_id": "old", "observed_at": "2026-10-09T10:04:00+09:00"}
        self.race["snapshots"]["t5"] = snapshot
        self.race["receipts"]["old"] = "2026-10-09T10:06:00+09:00"
        before = copy.deepcopy(snapshot)
        self.assertFalse(public_eligible(self.race, snapshot))
        self.observer.apply_schedule(self.race, self.bundle, {"race": self.race})
        self.assertEqual(snapshot, before)
        self.assertFalse(public_eligible(self.race, snapshot))
        self.assertEqual(snapshot_deadline(self.race, snapshot), "2026-10-09T10:05:00+09:00")
        self.assertIsNone(edge_v2.phase_due(self.race, datetime.fromisoformat("2026-10-09T10:08:00+09:00")))

    def test_old_responses_other_venues_and_finished_races_do_not_overwrite(self):
        self.observer.apply_schedule(self.race, self.bundle, {"race": self.race})
        old = copy.deepcopy(self.bundle)
        old["evidence"]["obtained_at"] = "2026-10-09T09:29:00+09:00"
        old["deadlines"][4] = "10:05"
        self.observer.apply_schedule(self.race, old, {"race": self.race})
        self.assertEqual(self.race["start_time_jst"], "10:14")
        for changes in ({"venue_code": "14"}, {"result": {"combination": "1-2-3"}}):
            other = dict(self.race, **changes)
            before = copy.deepcopy(other)
            self.observer.apply_schedule(self.race, self.bundle, {"other": other})
            self.assertEqual(other, before)

    def test_frozen_loader_input_uses_official_clock_not_stale_upstream(self):
        self.observer.apply_schedule(self.race, self.bundle, {"race": self.race})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = prepare_forward._day_path(root, "programs/title", "2026-10-09")
            path.parent.mkdir(parents=True)
            pd.DataFrame([{"レースコード": "202610092304", "電話投票締切予定": "10:05"},
                          {"レースコード": "202610091404", "電話投票締切予定": "09:48"}]).to_csv(path, index=False)
            self.observer.overlay_deadlines(root, "2026-10-09")
            self.assertEqual(pd.read_csv(path)["電話投票締切予定"].tolist(), ["10:14", "09:48"])

    def test_missing_exhibition_still_applies_official_deadline(self):
        bundle = dict(self.bundle, preview=None, error="Official numeric field missing")
        with tempfile.TemporaryDirectory() as directory, \
                patch("scripts.edge_official.fetch_preview_bundle", return_value=bundle) as fetch:
            self.observer.overlay_previews(Path(directory), "2026-10-09", {"race": "t30"}, {"race": self.race})
        fetch.assert_called_once()
        self.assertEqual(self.race["start_time_jst"], "10:14")
        self.assertEqual(self.race["preview_error"]["reason"], "Official numeric field missing")

    def test_tick_rechecks_window_after_preview_and_reloads_model_input(self):
        rid = "202610092304"
        state = {"date": "2026-10-09", "races": {rid: self.race}}
        self.observer.models = {"morning": object(), "exhibition": object()}
        self.observer.hybrid = self.observer.module = object()
        clock = datetime.fromisoformat("2026-10-09T09:58:00+09:00")
        frame = pd.DataFrame([{"race_id": rid}])
        record = dict(self.race, entries=[{"lane_no": i, "racer_id": str(i)} for i in range(1,7)])
        def preview(*args):
            self.observer.apply_schedule(self.race, self.bundle, state["races"])
        with patch.object(self.observer, "load", return_value=(Path("unused"), frame)), \
                patch.object(self.observer, "overlay_previews", side_effect=preview), \
                patch.object(self.observer, "overlay_deadlines") as overlay, \
                patch.object(prepare_forward, "_load_cards", return_value=(None, None)), \
                patch.object(prepare_forward, "_race_record", return_value=record), \
                patch.object(prepare_forward, "_race_is_publishable", return_value=True), \
                patch.object(prepare_forward, "_load_service_day_compatible", return_value=frame) as reload, \
                patch.object(edge_v2, "utcnow", return_value=clock), \
                patch.object(edge_v2, "predict_full", return_value={rid: {}}), \
                patch.object(edge_v2, "fetch_grid", return_value=None), \
                patch.object(edge_v2, "capture") as capture:
            self.observer.tick(state)
        overlay.assert_called_once()
        reload.assert_called_once()
        self.assertEqual(capture.call_args.args[1], "t15")
        self.assertEqual(capture.call_args.args[0]["start_time_jst"], "10:14")


if __name__ == "__main__":
    unittest.main()
