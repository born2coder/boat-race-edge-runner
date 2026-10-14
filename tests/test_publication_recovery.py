import copy
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

from scripts import watch_research_forward as flow


class PublicationRecoveryTests(unittest.TestCase):
    def state(self):
        now = datetime(2026, 10, 12, 10, tzinfo=timezone.utc)
        return {"date": "2026-10-12", "races": {"202610120101": {
            "race_id": "BR:20261012:01:01", "race_date": "2026-10-12",
            "venue_code": "01", "venue": "桐生", "race_no": 1,
            "start_at": (now+timedelta(minutes=20)).isoformat(),
            "snapshots": {"t20": {"snapshot_id": "old"}}, "receipts": {}}}}

    def test_transient_public_read_failure_excludes_batch_permanently(self):
        errors = [TimeoutError(), flow.urllib.error.URLError(TimeoutError())]
        errors += [flow.urllib.error.HTTPError("https://example.test", c, "", None, None)
                   for c in (404, 502, 503, 504)]
        for error in errors:
            with self.subTest(error=error):
                state = self.state(); publisher = Mock(revision="a"*40)
                with patch.object(flow.edge, "confirm_publication", side_effect=error), patch("builtins.print"):
                    self.assertFalse(flow.confirm_or_defer(state, publisher))
                publisher.acknowledge.assert_not_called()
                self.assertEqual(state["forward_observations_ignored"], ["old"])
                if isinstance(error, flow.urllib.error.HTTPError):
                    self.assertEqual(state["forward_publication_wait"]["http_status"], error.code)
                # Even a later readback of the same snapshot cannot make it fresh.
                race = state["races"]["202610120101"]
                now = datetime(2026, 10, 12, 10, 5, tzinfo=timezone.utc)
                race["receipts"]["old"] = now.isoformat()
                self.assertEqual(flow.payload(state, now)["observations"], [])
                race["snapshots"]["t15"] = {"snapshot_id": "fresh"}
                race["receipts"]["fresh"] = now.isoformat()
                with patch.object(flow.edge, "confirm_publication", return_value={"storage_branch":"edge-data"}):
                    self.assertTrue(flow.confirm_or_defer(state, publisher))
                self.assertEqual(state["forward_publication_wait"]["status"], "ready")
                self.assertEqual([o["snapshot"]["snapshot_id"] for o in flow.payload(state,now)["observations"]], ["fresh"])

    def test_auth_quota_invalid_data_and_unknown_errors_still_raise(self):
        errors = [ValueError("mismatch"), RuntimeError("unknown"),
                  flow.urllib.error.URLError("certificate failure")]
        errors += [flow.urllib.error.HTTPError("https://example.test", c, "", None, None)
                   for c in (401, 403, 429)]
        for error in errors:
            state = self.state(); before = copy.deepcopy(state)
            with self.subTest(error=error), patch.object(flow.edge, "confirm_publication", side_effect=error):
                with self.assertRaises(type(error)):
                    flow.confirm_or_defer(state, Mock(revision="a"*40))
            self.assertEqual(state, before)

    def test_second_consecutive_immutable_404_still_stops(self):
        state = self.state(); publisher = Mock(revision="a"*40)
        first = flow.urllib.error.HTTPError("https://example.test", 404, "", None, None)
        with patch.object(flow.edge, "confirm_publication", side_effect=first), patch("builtins.print"):
            self.assertFalse(flow.confirm_or_defer(state, publisher))
        state["races"]["202610120101"]["snapshots"]["t15"] = {"snapshot_id": "fresh"}
        before = copy.deepcopy(state)
        second = flow.urllib.error.HTTPError("https://example.test", 404, "", None, None)
        with patch.object(flow.edge, "confirm_publication", side_effect=second):
            with self.assertRaises(flow.urllib.error.HTTPError):
                flow.confirm_or_defer(state, publisher)
        self.assertEqual(state, before)

    def test_results_and_heartbeat_do_not_read_whole_day_again(self):
        state = self.state(); state["forward_observations_sent"] = ["old"]
        with patch.object(flow.edge, "confirm_publication") as read:
            self.assertTrue(flow.confirm_or_defer(state, Mock()))
        read.assert_not_called()

    def run_main(self, *, exhaust=False, ingestion_failure=False):
        clock=[0.0]; captures=[]; reads=[]; deliveries=[]
        base=datetime(2026,10,12,10,tzinfo=timezone.utc)
        fixture=self.state()
        class Publisher:
            revision="a"*40
            def __init__(self,*args): pass
            @staticmethod
            def git(*args): pass
            def persist(self): pass
            def acknowledge(self,*args): pass
        class Observer:
            def __init__(self,*args): pass
            def tick(self,state,max_observations=None):
                captures.append(clock[0])
                if len(captures)==1:
                    state["races"]=copy.deepcopy(fixture["races"])
                    if exhaust: clock[0]=315*60-2
                else:
                    state["races"]["202610120101"]["snapshots"]["t15"]={"snapshot_id":"fresh"}
                    flow.os.environ["RESEARCH_FORWARD_ONCE"]="1"
            def settle(self,state): pass
        def read(state,revision):
            reads.append(clock[0])
            if len(reads)==1: raise TimeoutError()
            for race in state["races"].values():
                for snap in race["snapshots"].values():
                    race["receipts"][snap["snapshot_id"]]=(base+timedelta(seconds=clock[0])).isoformat()
            return {}
        def send(body):
            deliveries.append(body)
            if ingestion_failure: raise TimeoutError()
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            with patch.dict(flow.os.environ,{"EDGE_REPOSITORY_VISIBILITY":"public","RESEARCH_FORWARD_ONCE":"0"}), \
                 patch.object(flow.edge,"STATE",root),patch.object(flow,"DataPublisher",Publisher), \
                 patch.object(flow.edge,"Observer",Observer),patch.object(flow.edge,"confirm_publication",side_effect=read), \
                 patch.object(flow.edge,"utcnow",side_effect=lambda:base+timedelta(seconds=clock[0])), \
                 patch.object(flow.time,"monotonic",side_effect=lambda:clock[0]), \
                 patch.object(flow.time,"sleep",side_effect=lambda delay:clock.__setitem__(0,clock[0]+delay)), \
                 patch.object(flow,"send",side_effect=send),patch("builtins.print"):
                if ingestion_failure:
                    with self.assertRaises(TimeoutError): flow.main()
                else: flow.main()
            stop=root/"forward-paused.json"
            return captures,deliveries,clock[0],json.loads(stop.read_text()) if stop.exists() else None

    def test_main_recovers_after_five_minutes_without_replaying_failed_batch(self):
        captures,deliveries,clock,stop=self.run_main()
        self.assertEqual(captures,[0,300]); self.assertIsNone(stop)
        self.assertEqual(len(deliveries),1)
        self.assertEqual([o["snapshot"]["snapshot_id"] for o in deliveries[0]["observations"]],["fresh"])

    def test_defer_never_extends_existing_run_limit(self):
        captures,deliveries,clock,stop=self.run_main(exhaust=True)
        self.assertEqual(clock,315*60); self.assertEqual(captures,[0])
        self.assertEqual(deliveries,[]); self.assertIsNone(stop)

    def test_ingestion_timeout_still_stops_without_retry_and_records_stage(self):
        captures,deliveries,clock,stop=self.run_main(ingestion_failure=True)
        self.assertEqual(len(deliveries),1)
        self.assertEqual(stop["kind"],"TimeoutError")
        self.assertEqual(stop["stage"],"ingestion")


if __name__ == "__main__": unittest.main()
