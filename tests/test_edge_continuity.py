from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, mock

from scripts import watch_edge_v2 as watch, edge_v2


class ContinuityTests(TestCase):
    def test_night_wait_crosses_into_morning_and_dispatches_successor(self):
        clock = [0]
        # 06:59 JST: the previous implementation exited before the first race.
        start = datetime(2026, 9, 14, 21, 59, tzinfo=timezone.utc)
        observer = mock.Mock()
        with TemporaryDirectory() as folder, \
             mock.patch.dict("os.environ", {"EDGE_REPOSITORY_VISIBILITY": "public"}), \
             mock.patch.object(watch, "git"), \
             mock.patch.object(watch, "DataPublisher"), \
             mock.patch.object(watch.edge, "STATE", Path(folder)), \
             mock.patch.object(watch.edge, "Observer", return_value=observer), \
             mock.patch.object(watch.edge, "write_state"), \
             mock.patch.object(watch.edge, "confirm_publication", return_value={"storage_branch": "edge-data"}), \
             mock.patch.object(watch.edge, "utcnow", side_effect=lambda: start + timedelta(seconds=clock[0])), \
             mock.patch.object(watch.time, "monotonic", side_effect=lambda: clock[0]), \
             mock.patch.object(watch.time, "sleep", side_effect=lambda seconds: clock.__setitem__(0, clock[0] + seconds)), \
             mock.patch.object(watch, "MAX_SECONDS", 180), \
             mock.patch.object(watch, "continue_observer") as successor:
            watch.main()
        self.assertGreaterEqual(observer.tick.call_count, 1)
        successor.assert_called_once_with()

    def test_empty_day_does_not_request_nonexistent_results_archive(self):
        state = {"races": {}, "result_error": {"kind": "HTTPError"}}
        with mock.patch.object(edge_v2.build_fixture, "fetch_artifact") as fetch:
            edge_v2.Observer.__new__(edge_v2.Observer).settle(state)
        fetch.assert_not_called()
        self.assertIsNone(state["result_error"])

    def test_current_archive_404_is_pending_but_server_failure_is_an_error(self):
        from urllib.error import HTTPError
        now = datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc)
        for status in (404, 503):
            observer = edge_v2.Observer.__new__(edge_v2.Observer)
            observer.archive_checks = {}
            state = {"date": "2026-09-15", "races": {"future": {"start_at": "2026-09-15T01:00:00+00:00"}}}
            with mock.patch.object(edge_v2, "utcnow", return_value=now), \
                 mock.patch.object(edge_v2.build_fixture, "fetch_artifact", side_effect=HTTPError("https://example.test", status, "test", {}, None)):
                observer.settle(state)
            if status == 404:
                self.assertIsNone(state["result_error"])
            else:
                self.assertEqual(state["result_error"]["kind"], "HTTPError")

    def test_exhibition_retries_transport_timeout_with_a_bound(self):
        import io
        from scripts import edge_official
        race = {"race_date": "2026-09-15", "venue_code": 10, "race_no": 2}
        with mock.patch.object(edge_official.urllib.request, "urlopen", side_effect=[TimeoutError(), io.BytesIO(b"ok")]) as get:
            body, evidence = edge_official.page(race, "beforeinfo")
        self.assertEqual(body, "ok")
        self.assertEqual(get.call_count, 2)
        self.assertEqual(get.call_args.kwargs["timeout"], 15)
        with mock.patch.object(edge_official.urllib.request, "urlopen", side_effect=TimeoutError()) as get:
            with self.assertRaises(TimeoutError):
                edge_official.page(race, "beforeinfo")
        self.assertEqual(get.call_count, 2)
