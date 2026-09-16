from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class EdgeWorkflowScheduleTest(unittest.TestCase):
    def test_edge_watchers_are_scheduled_in_utc_for_jst_service_hours(self):
        workflow = (ROOT / ".github" / "workflows" / "edge.yml").read_text(encoding="utf-8")

        self.assertIn('cron: "47 22 * * *"', workflow)  # 07:47 JST
        self.assertIn('cron: "37 4 * * *"', workflow)  # 13:37 JST
        self.assertIn('cron: "7 10 * * *"', workflow)  # 19:07 JST
        self.assertNotIn("timezone:", workflow)
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'push' }}", workflow)
        self.assertIn("watch_edge_v2.py", workflow)
        self.assertIn("actions: write", workflow)

    def test_results_workflow_recovers_a_missing_edge_observer(self):
        workflow = (ROOT / ".github" / "workflows" / "results.yml").read_text(encoding="utf-8")

        self.assertIn("actions: write", workflow)
        self.assertIn("Ensure EDGE observer is running", workflow)
        self.assertIn("actions/workflows/edge.yml/runs", workflow)
        self.assertIn("actions/workflows/edge.yml/dispatches", workflow)
        self.assertIn('"queued", "in_progress"', workflow)

    def test_results_workflow_recovers_a_missing_hit_observer(self):
        workflow = (ROOT / ".github" / "workflows" / "results.yml").read_text(encoding="utf-8")

        self.assertIn("Ensure HIT observer is running", workflow)
        self.assertIn("actions/workflows/forward.yml/dispatches", workflow)

    def test_results_workflow_backfills_recent_service_days(self):
        workflow = (ROOT / ".github" / "workflows" / "results.yml").read_text(encoding="utf-8")

        self.assertIn("lookback_days=2", workflow)
        self.assertIn("lookback_days=14", workflow)
        self.assertIn('date -d "$today - $offset days"', workflow)
        self.assertIn('for service_date in "${dates[@]}"', workflow)

    def test_forward_watchers_are_scheduled_in_utc_for_jst_service_hours(self):
        workflow = (ROOT / ".github" / "workflows" / "forward.yml").read_text(encoding="utf-8")

        self.assertIn('cron: "0 21 * * *"', workflow)  # 06:00 JST
        self.assertIn('cron: "45 2 * * *"', workflow)  # 11:45 JST
        self.assertIn('cron: "30 8 * * *"', workflow)  # 17:30 JST
        self.assertNotIn("timezone:", workflow)
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'push' }}", workflow)
        self.assertIn("actions: write", workflow)


if __name__ == "__main__":
    unittest.main()
