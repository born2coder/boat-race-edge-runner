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
        self.assertIn('prediction["tickets"] = prediction["tickets"][:8]', source)
        self.assertIn('prediction["virtual_stake_yen"] = 300', source)
        self.assertNotIn('prediction["tickets"] = prediction["tickets"][:3]', source)

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


if __name__ == "__main__":
    unittest.main()
