from __future__ import annotations

import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import pandas as pd

from scripts.mark_published import main as mark_main
from scripts.prepare_forward import _load_service_day_compatible, _safe_extract


class PreviewTimezoneTests(unittest.TestCase):
    def load(self, previews):
        module = SimpleNamespace()
        original = lambda root, source, day: previews.get(source, pd.DataFrame({"race_id": pd.Series(dtype=str)}))
        module._preview = original

        def load_service_day(root, day):
            frame = pd.DataFrame({"race_id": ["r1", "r2"]})
            columns = []
            for source in ("tkz", "stt", "sui"):
                frame = frame.merge(module._preview(root, source, day), on="race_id", how="left")
                column = f"{source}_obtained_at"
                if column not in frame:
                    frame[column] = pd.NaT
                columns.append(column)
            frame["source_ready_at"] = frame[columns].max(axis=1)
            frame["source_safe"] = frame[columns].notna().all(axis=1) & frame["source_ready_at"].le(pd.Timestamp("2026-09-05T10:00:00+09:00"))
            return frame

        module.load_service_day = load_service_day
        result = _load_service_day_compatible(module, Path("unused"), "2026-09-05")
        self.assertIs(module._preview, original)
        return result

    def previews(self, sources, timestamp="2026-09-05T09:50:00+09:00"):
        return {source: pd.DataFrame({"race_id": ["r1"], f"{source}_obtained_at": [timestamp]}) for source in sources}

    def test_all_previews_absent_still_loads_morning_races(self):
        frame = self.load({})
        self.assertEqual(len(frame), 2)
        self.assertTrue(frame.source_ready_at.isna().all())
        self.assertEqual(str(frame.source_ready_at.dtype), "datetime64[ns, Asia/Tokyo]")
        self.assertFalse(frame.source_safe.any())

    def test_partial_previews_do_not_enable_badge(self):
        self.assertFalse(self.load(self.previews(["tkz", "stt"])).source_safe.any())

    def test_complete_previews_only_enable_matching_race(self):
        self.assertEqual(self.load(self.previews(["tkz", "stt", "sui"])).source_safe.tolist(), [True, False])

    def test_late_or_invalid_timestamps_do_not_enable_badge(self):
        for value in ("2026-09-05T10:01:00+09:00", "invalid", None):
            with self.subTest(value=value):
                self.assertFalse(self.load(self.previews(["tkz", "stt", "sui"], value)).source_safe.any())

    def test_preview_function_restored_on_failure(self):
        original = lambda *args: None
        def fail(*args):
            raise ValueError("invalid cards")
        module = SimpleNamespace(_preview=original, load_service_day=fail)
        with self.assertRaises(ValueError):
            _load_service_day_compatible(module, Path("unused"), "2026-09-05")
        self.assertIs(module._preview, original)


class RunnerSafetyTests(unittest.TestCase):
    def test_forward_runner_keeps_top8_and_buys_top3(self) -> None:
        source = (Path(__file__).parents[1] / "scripts" / "prepare_forward.py").read_text(encoding="utf-8")
        self.assertIn('for rank in range(1, 9)', source)
        self.assertIn('"virtual_stake_yen": 300', source)
        self.assertNotIn('prediction["tickets"] = prediction["tickets"][:3]', source)

    def test_forward_runner_locks_morning_top_ten_and_only_badges_later(self) -> None:
        source = (Path(__file__).parents[1] / "scripts" / "prepare_forward.py").read_text(encoding="utf-8")
        self.assertIn('MORNING_LOCK_DEADLINE = time(9, 30)', source)
        self.assertIn('.head(DAILY_CAP)', source)
        self.assertIn('"publication_mode": "morning_fixed_hit_v1"', source)
        self.assertIn('classify_reassessment', source)
        self.assertIn('"reassessments": pending_reassessments', source)

    def test_forward_runner_skips_dates_before_the_registered_start(self) -> None:
        source = (Path(__file__).parents[1] / "scripts" / "prepare_forward.py").read_text(encoding="utf-8")
        self.assertIn('"reason": "before_genuine_forward_start"', source)
        self.assertNotIn('raise RuntimeError("Requested date predates the registered forward start")', source)

    def test_safe_extract_rejects_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "unsafe.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                content = b"bad"
                member = tarfile.TarInfo("../outside.txt")
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
            with self.assertRaises(RuntimeError):
                _safe_extract(archive_path, root / "output")

    def test_mark_published_updates_publication_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state.json"
            path.write_text(
                json.dumps({"selected": [{"race_id_raw": "1"}], "published_count": 0}),
                encoding="utf-8",
            )
            previous = sys.argv
            try:
                sys.argv = ["mark_published.py", str(path)]
                mark_main()
            finally:
                sys.argv = previous
            state = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(state["published_count"], 1)
            self.assertIn("last_published_at", state)
            self.assertEqual(state["selected"], [{"race_id_raw": "1"}])

    def test_mark_published_records_reassessment_delivery(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state.json"
            path.write_text(json.dumps({
                "selected": [{
                    "prediction": {"prediction_id": "pred_a"},
                    "reassessment": {"status": "supported"},
                    "reassessment_published_at": None,
                }],
                "published_count": 1,
                "pending_reassessment_ids": ["pred_a"],
            }), encoding="utf-8")
            previous = sys.argv
            try:
                sys.argv = ["mark_published.py", str(path)]
                mark_main()
            finally:
                sys.argv = previous
            state = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(state["pending_reassessment_ids"], [])
            self.assertIsNotNone(state["selected"][0]["reassessment_published_at"])


if __name__ == "__main__":
    unittest.main()
