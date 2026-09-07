from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class EdgeWorkflowScheduleTest(unittest.TestCase):
    def test_edge_watchers_are_scheduled_in_utc_for_jst_service_hours(self):
        workflow = (ROOT / ".github" / "workflows" / "edge.yml").read_text(encoding="utf-8")

        self.assertIn('cron: "0 23 * * *"', workflow)  # 08:00 JST
        self.assertIn('cron: "30 4 * * *"', workflow)  # 13:30 JST
        self.assertIn('cron: "0 10 * * *"', workflow)  # 19:00 JST
        self.assertNotIn("timezone:", workflow)


if __name__ == "__main__":
    unittest.main()
