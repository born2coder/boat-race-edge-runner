from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.watch_edge import write_index


class EdgeAuditIndexTests(unittest.TestCase):
    def test_index_keeps_progress_and_candidate_history(self):
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            state_path = state_dir / "2026-09-07.json"
            state_path.write_text(json.dumps({
                "date": "2026-09-07",
                "observations": {
                    "race1": {"observed_at": "2026-09-07T01:00:00+00:00"},
                    "race2": {"observed_at": "2026-09-07T01:03:00+00:00"},
                },
                "candidates": [{"edge_id": "edge_example", "expected_value_percent": 155.0}],
            }), encoding="utf-8")

            index = json.loads(write_index(state_path).read_text(encoding="utf-8"))

            self.assertEqual(index["days"][0]["observed_count"], 2)
            self.assertEqual(index["days"][0]["last_observed_at"], "2026-09-07T01:03:00+00:00")
            self.assertEqual(index["days"][0]["candidates"][0]["expected_value_percent"], 155.0)


if __name__ == "__main__":
    unittest.main()
