from __future__ import annotations

import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

from scripts.mark_published import main as mark_main
from scripts.prepare_forward import _safe_extract


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
