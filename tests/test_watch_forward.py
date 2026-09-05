from __future__ import annotations

import copy
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from scripts.prepare_forward import _expire_pending_reassessments
from scripts import watch_forward as watch


def sample():
    return {"selected": [{"race": {"start_at": "2026-09-05T13:58:00+09:00"},
                          "prediction": {"prediction_id": "p", "tickets": ["1-2-3", "1-3-2", "1-2-4"]},
                          "reassessment": None, "reassessment_published_at": None}],
            "published_count": 1, "pending_reassessment_ids": []}


def at(value):
    return datetime.fromisoformat(f"2026-09-05T{value}+09:00")


class WatchTests(unittest.TestCase):
    def test_wait_then_check_before_exhibition_without_waiting_for_another_cron(self):
        self.assertEqual(watch.check_mode(sample(), at("13:20:00")), "idle")
        self.assertEqual(watch.check_mode(sample(), at("13:28:00")), "check")
        self.assertEqual(watch.check_mode(sample(), at("13:48:00")), "check")
        self.assertEqual(watch.check_mode(sample(), at("13:52:59")), "check")
        self.assertEqual(watch.check_mode(sample(), at("13:53:00")), "finished")
        self.assertEqual(watch.check_mode(sample(), at("14:05:00")), "finished")

    def test_finished_badges_need_no_more_source_requests(self):
        for field in ("reassessment_published_at", "reassessment_expired_at"):
            state = sample()
            state["selected"][0][field] = at("13:48:00").isoformat()
            self.assertEqual(watch.check_mode(state, at("13:50:00")), "finished")

    def test_missing_morning_sources_retry_only_within_the_morning_window(self):
        self.assertEqual(watch.check_mode(None, at("05:30:00")), "idle")
        self.assertEqual(watch.check_mode(None, at("06:00:00")), "check")
        self.assertEqual(watch.check_mode(None, at("09:20:00")), "check")
        self.assertEqual(watch.check_mode(None, at("09:31:00")), "finished")

    def test_retry_expires_at_cutoff_without_changing_morning_tickets(self):
        state = sample()
        state["pending_reassessment_ids"] = ["p"]
        state["selected"][0]["reassessment"] = {"status": "supported"}
        original = copy.deepcopy(state["selected"][0]["prediction"])
        self.assertEqual(watch.check_mode(state, at("14:00:00")), "check")
        _expire_pending_reassessments(state, at("13:52:59"))
        self.assertEqual(state["pending_reassessment_ids"], ["p"])
        _expire_pending_reassessments(state, at("13:53:00"))
        self.assertEqual(state["pending_reassessment_ids"], [])
        self.assertEqual(state["selected"][0]["prediction"], original)
        self.assertIsNone(state["selected"][0]["reassessment_published_at"])
        self.assertEqual(watch.check_mode(state, at("13:54:00")), "finished")

    def test_published_badge_is_not_rewritten_when_cutoff_passes(self):
        state = sample()
        state["selected"][0]["reassessment"] = {"status": "supported"}
        state["selected"][0]["reassessment_published_at"] = at("13:50:00").isoformat()
        original = copy.deepcopy(state)
        _expire_pending_reassessments(state, at("14:00:00"))
        self.assertEqual(state, original)

    def test_failed_lock_never_sends_and_failed_send_never_marks_published(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / ".runtime").mkdir()
            payload = root / ".runtime/payload.json"
            payload.write_text("{}")
            with patch.object(watch, "ROOT", root), patch.object(watch, "persist_state", side_effect=RuntimeError), patch.object(watch, "run") as run:
                with self.assertRaises(RuntimeError):
                    watch.publish_pending(root / "state.json")
                run.assert_not_called()
            with patch.object(watch, "ROOT", root), patch.object(watch, "persist_state"), patch.object(watch, "run", side_effect=RuntimeError) as run:
                with self.assertRaises(RuntimeError):
                    watch.publish_pending(root / "state.json")
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args.args[1], "scripts/send_payload.py")
                self.assertTrue(payload.exists())

    def test_private_repository_cannot_start_continuous_work(self):
        with patch.dict("os.environ", {"EDGE_REPOSITORY_VISIBILITY": "private"}), patch.object(watch, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "public repository"):
                watch.main()
            run.assert_not_called()

    def test_running_process_repeats_checks_and_survives_a_transient_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / "state" / watch.prepare_forward.MODEL_VERSION / "2026-09-05.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(sample()))
            with patch.dict("os.environ", {"EDGE_REPOSITORY_VISIBILITY": "public"}), patch.object(watch, "ROOT", root), patch.object(watch, "datetime") as clock, patch.object(watch, "run"), patch.object(watch, "publish_pending") as publish, patch.object(watch.prepare_forward, "main", side_effect=[RuntimeError("temporary"), None]) as prepare, patch.object(watch.time, "monotonic", side_effect=[0, 0, 60, watch.MAX_SECONDS]), patch.object(watch.time, "sleep") as sleep:
                clock.now.return_value = at("13:48:00")
                clock.fromisoformat.side_effect = datetime.fromisoformat
                watch.main()
                self.assertEqual(prepare.call_count, 2)
                self.assertEqual(publish.call_count, 1)
                self.assertEqual(sleep.call_count, 2)
                self.assertEqual(prepare.call_args_list[0], prepare.call_args_list[1])


if __name__ == "__main__":
    unittest.main()
