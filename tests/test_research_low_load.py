import os
import unittest
from unittest.mock import patch

from scripts import watch_edge_v2 as watch


class ResearchLowLoadTest(unittest.TestCase):
    def test_automatic_ticks_do_not_publish_research_by_default(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(watch.publish_research, "publish") as publish:
            for _ in range(3):
                self.assertEqual(watch.publish_automatic_research("2026-09-30")["status"], "skipped")
            publish.assert_not_called()

    def test_automatic_publication_requires_explicit_opt_in(self):
        with patch.dict(os.environ, {"EDGE_RESEARCH_AUTO_PUBLISH": "1"}), patch.object(watch.publish_research, "publish", return_value={"status": "complete"}) as publish:
            self.assertEqual(watch.publish_automatic_research("2026-09-30")["status"], "complete")
            publish.assert_called_once_with("2026-09-30")


if __name__ == "__main__":
    unittest.main()
