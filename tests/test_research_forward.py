import copy
import unittest
import json
import tempfile
import io
from email.message import Message
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from scripts import watch_research_forward as flow

class ForwardPayloadTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime.now(timezone.utc)
        self.race={"race_id":"BR:20261008:01:01","race_date":"2026-10-08","venue_code":"01",
                   "venue":"桐生","race_no":1,"start_at":(self.now+timedelta(minutes=15)).isoformat(),
                   "snapshots":{"t15":{"snapshot_id":"new"}},"receipts":{"new":self.now.isoformat()}}
        self.state={"date":"2026-10-08","races":{"202610080101":self.race}}
    def test_only_fresh_future_unsent_observations(self):
        self.assertEqual(len(flow.payload(self.state,self.now)["observations"]),1)
        self.assertEqual(flow.payload(self.state,self.now+timedelta(seconds=26))["observations"],[])
        self.state["forward_observations_sent"]=["new"]
        self.assertEqual(flow.payload(self.state,self.now)["observations"],[])
        self.state["forward_observations_sent"]=[]
        self.state["forward_observations_ignored"]=["new"]
        self.assertEqual(flow.payload(self.state,self.now)["observations"],[])
        self.state["forward_observations_ignored"]=[]
        self.race["start_at"]=self.now.isoformat()
        self.assertEqual(flow.payload(self.state,self.now)["observations"],[])
    def test_deadline_change_never_revives_expired_snapshot_or_closed_race(self):
        self.race["snapshot_deadlines"]={"new":(self.now-timedelta(seconds=1)).isoformat()}
        self.assertEqual(flow.payload(self.state,self.now)["observations"],[])
        self.race["snapshot_deadlines"]["new"]=(self.now+timedelta(minutes=10)).isoformat()
        sent=flow.payload(self.state,self.now)["observations"][0]
        self.assertEqual(sent["start_at"],self.race["snapshot_deadlines"]["new"])
        self.race["start_at"]=self.now.isoformat()
        self.assertEqual(flow.payload(self.state,self.now)["observations"],[])

    def test_results_only_for_recorded_cohort_and_unchanged_result_dedup(self):
        self.race["result"]={"combination":"1-2-3","payout_per_100_yen":1000,"refunded_lanes":[],
                             "evidence":{"obtained_at":self.now.isoformat()}}
        self.assertEqual(flow.payload(self.state,self.now)["results"],[])
        self.state["forward_observations_sent"]=["new"]
        self.assertEqual(len(flow.payload(self.state,self.now)["results"]),1)
        self.state["forward_results_sent"]=[flow.result_key(self.race)]
        self.race["result"]["evidence"]["obtained_at"]=(self.now+timedelta(minutes=1)).isoformat()
        self.assertEqual(flow.payload(self.state,self.now)["results"],[])
        self.race["result"]["payout_per_100_yen"]=1100
        self.assertEqual(len(flow.payload(self.state,self.now)["results"]),1)
    def test_batch_overflow_halts_instead_of_sampling(self):
        self.state["races"]={str(i):copy.deepcopy(self.race) for i in range(25)}
        with self.assertRaises(RuntimeError):flow.payload(self.state,self.now)

    def test_live_and_archive_result_receipts_are_equivalent_but_corrections_are_not(self):
        self.race["result"]={"combination":"1-2-3","payout_per_100_yen":1000,
                             "refunded_lanes":[],"evidence":{"obtained_at":self.now.isoformat()}}
        old={k:self.race["result"].get(k) for k in ("combination","payout_per_100_yen","refunded_lanes","cancelled")}
        legacy=flow.result_fingerprint(self.race["race_id"],old)
        canonical=flow.result_key(self.race)
        self.race["result"]["cancelled"]=False
        self.assertEqual(flow.result_key(self.race),canonical)
        self.assertTrue(flow.result_was_sent(self.race,[legacy]))
        self.race["result"]["payout_per_100_yen"]=1100
        self.assertFalse(flow.result_was_sent(self.race,[legacy,canonical]))
        self.race["result"]["cancelled"]=True
        self.assertFalse(flow.result_was_sent(self.race,[legacy,canonical]))

    def test_result_backlog_drains_across_restart_without_loss_or_duplicates(self):
        state={"date":"2026-10-08","races":{},"forward_observations_sent":[]}
        for i in range(60):
            race=copy.deepcopy(self.race)
            race["race_id"]=f"BR:20261008:{i//12+1:02}:{i%12+1:02}"
            race["snapshots"]={"t15":{"snapshot_id":str(i)}}
            race["result"]={"combination":"1-2-3","payout_per_100_yen":1000,
                "refunded_lanes":[],"evidence":{"obtained_at":self.now.isoformat()}}
            state["races"][flow.edge.raw_id(race["race_id"])]=race
            state["forward_observations_sent"].append(str(i))
        received=[];sizes=[]
        with patch("builtins.print"):
            for _ in range(3):
                body=flow.bound_results(flow.payload(state,self.now))
                sizes.append(len(body["results"]))
                # Before success, a restart must keep the exact same queue.
                replay=flow.bound_results(flow.payload(json.loads(json.dumps(state)),self.now))
                self.assertEqual(replay,body)
                received.extend(r["raceId"] for r in body["results"])
                flow.acknowledge_results(state,body["results"])
                state=json.loads(json.dumps(state))
        self.assertEqual(sizes,[24,24,12])
        self.assertEqual(len(set(received)),60)
        self.assertEqual(flow.payload(state,self.now)["results"],[])

    def test_previous_and_current_day_share_one_result_limit(self):
        def rows(date):return [{"raceId":f"BR:{date}:01:{i:02}","result":{"confirmedAt":date}} for i in range(1,21)]
        with patch("builtins.print"):
            body=flow.bound_results({"observations":["fresh"],"results":rows("20261009")},
                                    {"results":rows("20261008")})
        self.assertEqual(len(body["results"]),24)
        self.assertEqual(body["observations"],["fresh"])
        self.assertEqual(sum(r["raceId"].startswith("BR:20261008") for r in body["results"]),20)
    def test_send_refuses_unreviewed_destination_before_network(self):
        with patch.dict(flow.os.environ,{"EDGE_SITE_INGEST_ENDPOINT":"https://other.example/api/internal/ingest"}):
            with patch.object(flow.urllib.request,"urlopen") as network:
                with self.assertRaises(RuntimeError):flow.send({})
                network.assert_not_called()

    def test_failed_tick_is_saved_with_race_phase_reason_before_stop(self):
        self.race["errors"]={"t15":{"at":self.now.isoformat(),"reason":"HTTP Error 503: Service Unavailable"},
            "t30":{"at":(self.now-timedelta(minutes=30)).isoformat(),"reason":"old failure"}}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/"day.json"
            with self.assertRaises(RuntimeError),patch("builtins.print") as log:
                flow.check_observations(self.state,self.now,path)
            saved=json.loads(path.read_text())
            self.assertEqual(saved,self.state)
            event=json.loads(log.call_args.args[0])
            self.assertEqual(event["errors"],[{"raceId":self.race["race_id"],"phase":"t15",
                "at":self.now.isoformat(),"reason":"HTTP Error 503: Service Unavailable"}])
            self.assertNotIn("forward_observations_sent",saved)

    def test_stale_odds_are_excluded_once_per_phase_without_stopping_other_races(self):
        self.race["snapshots"]={}
        self.race["errors"]={"t15":{"at":self.now.isoformat(),"reason":"Official odds are stale or from the future"}}
        other=copy.deepcopy(self.race)
        other["race_id"]="BR:20261008:02:01"
        other["errors"]={}
        self.state["races"]["202610080201"]=other
        with tempfile.TemporaryDirectory() as folder,patch("builtins.print"):
            path=Path(folder)/"day.json"
            flow.check_observations(self.state,self.now,path)
            self.assertEqual(json.loads(path.read_text()),self.state)
        self.assertIsNone(flow.edge.phase_due(self.race,self.now))
        self.assertEqual(flow.edge.phase_due(other,self.now),"t15")
        self.assertEqual(flow.edge.phase_due(self.race,self.now+timedelta(minutes=5)),"t10")
        self.assertEqual(self.race["snapshots"],{})
        self.assertEqual(flow.payload(self.state,self.now)["observations"],[])

    def test_incomplete_odds_exclude_only_failed_phase_and_keep_healthy_payload(self):
        for count in (0, 24, 60, 119):
            with self.subTest(count=count):
                bad=copy.deepcopy(self.race)
                bad["race_id"]="BR:20261008:08:08"
                bad["snapshots"]={}
                bad["errors"]={"t15":{"at":self.now.isoformat(),
                    "reason":f"Official odds grid was incomplete: {count}/120"}}
                self.state["races"]["202610080808"]=bad
                with tempfile.TemporaryDirectory() as folder,patch("builtins.print"):
                    path=Path(folder)/"day.json"
                    flow.check_observations(self.state,self.now,path)
                    saved=json.loads(path.read_text())
                self.assertIsNone(flow.edge.phase_due(bad,self.now))
                self.assertEqual(flow.edge.phase_due(bad,self.now+timedelta(minutes=5)),"t10")
                self.assertEqual(bad["snapshots"],{})
                observations=flow.payload(saved,self.now)["observations"]
                self.assertEqual([o["snapshot"]["snapshot_id"] for o in observations],["new"])
                self.assertIn("t15",saved["races"]["202610080808"]["forward_skipped_phases"])

    def test_unknown_or_impossible_odds_errors_still_stop(self):
        for reason in ("Official odds grid was incomplete: 121/120", "Invalid odds",
                       "Model combination ordering differs"):
            with self.subTest(reason=reason),tempfile.TemporaryDirectory() as folder,patch("builtins.print"):
                self.race["errors"]={"t15":{"at":self.now.isoformat(),"reason":reason}}
                with self.assertRaises(RuntimeError):
                    flow.check_observations(self.state,self.now,Path(folder)/"day.json")

    def test_http_error_preserves_allowlisted_evidence_without_retry_or_secrets(self):
        headers=Message()
        headers["Retry-After"]="40"
        headers["X-Vercel-Id"]="hnd1::request-123"
        error=flow.urllib.error.HTTPError("https://boat-race-edge-runner.vercel.app/api/internal/research-forward",
            429,"Too Many Requests",headers,io.BytesIO(b'{"status":"rate_limited","secret":"never-save"}'))
        with patch.dict(flow.os.environ,{"EDGE_SITE_INGEST_ENDPOINT":"https://boat-race-edge-runner.vercel.app/api/internal/ingest",
                "EDGE_SITE_INGEST_SECRET":"test-only"}),patch.object(flow.urllib.request,"urlopen",side_effect=error) as network,patch("builtins.print") as log:
            with self.assertRaises(flow.urllib.error.HTTPError) as raised:
                flow.send({"observations":[],"results":[{}]})
        self.assertIs(raised.exception,error)
        network.assert_called_once()
        self.assertEqual(error.forward_diagnostics,{"httpStatus":429,"observationCount":0,"resultCount":1,
            "responseStatus":"rate_limited","retryAfter":"40","requestId":"hnd1::request-123"})
        self.assertNotIn("never-save",str(log.call_args))

    def test_unknown_error_body_is_not_persisted(self):
        error=flow.urllib.error.HTTPError("https://example.test",429,"limited",None,
            io.BytesIO(b'<html>private token</html>'))
        self.assertEqual(flow.http_failure_details(error,{"observations":[],"results":[]}),
            {"httpStatus":429,"observationCount":0,"resultCount":0})

    def test_main_waits_before_capture_and_persists_http_stop(self):
        self._main_timing_check(previous_completion=None)

    def test_next_run_honors_saved_completion_before_capture(self):
        self._main_timing_check(previous_completion=-20)

    def _main_timing_check(self,previous_completion):
        # No real clock waits, Git commands, model loads or external requests.
        clock=[0.0]; captures=[]; sends=[]
        base=datetime(2026,10,8,8,tzinfo=timezone.utc)
        def now(): return base+timedelta(seconds=clock[0])
        state={"date":"2026-10-08","races":{}}
        if previous_completion is not None:
            state["forward_last_send_completed_at"]=(base+timedelta(seconds=previous_completion)).isoformat()
        class Publisher:
            revision="a"*40
            def __init__(self,*args): pass
            @staticmethod
            def git(*args): pass
            def persist(self): pass
            def acknowledge(self,*args): pass
        class Observer:
            def __init__(self,*args): pass
            def tick(self,state, max_observations=None):
                assert max_observations == 24
                captures.append(clock[0]); clock[0]+=32 if len(captures)==1 else 11
            def settle(self,state): clock[0]+=9
        error=flow.urllib.error.HTTPError("https://example.test",429,"limited",None,None)
        error.forward_diagnostics={"httpStatus":429,"responseStatus":"rate_limited"}
        def send(body):
            sends.append(clock[0])
            if len(sends)==2: raise error
            clock[0]+=5  # The guard must use response completion, not request start.
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            day=root/"days/2026-10-08.json"
            flow.prepare_forward._atomic_json(day,state)
            with patch.dict(flow.os.environ,{"EDGE_REPOSITORY_VISIBILITY":"public","RESEARCH_FORWARD_ONCE":"0"}), \
                 patch.object(flow.edge,"STATE",root),patch.object(flow,"DataPublisher",Publisher), \
                 patch.object(flow.edge,"Observer",Observer),patch.object(flow.edge,"utcnow",now), \
                 patch.object(flow.edge,"confirm_publication",return_value={}), \
                 patch.object(flow.time,"monotonic",side_effect=lambda:clock[0]), \
                 patch.object(flow.time,"sleep",side_effect=lambda delay:clock.__setitem__(0,clock[0]+delay)), \
                 patch.object(flow,"send",side_effect=send),patch("builtins.print"):
                # Reproduce an observation send followed by a result-only send.
                with patch.object(flow,"payload",side_effect=[{"observations":[{"snapshot":{"snapshot_id":"new"}}],"results":[]},
                    {"observations":[],"results":[{"raceId":"BR:20261008:01:04","result":{"confirmedAt":base.isoformat()}}]}]):
                    with self.assertRaises(flow.urllib.error.HTTPError): flow.main()
            stop=json.loads((root/"forward-paused.json").read_text())
            saved=json.loads(day.read_text())
        self.assertEqual(stop["http"],error.forward_diagnostics)
        self.assertEqual(stop["kind"],"HTTPError")
        self.assertEqual(saved["forward_last_send_completed_at"],(base+timedelta(seconds=sends[0]+5)).isoformat())
        self.assertGreaterEqual(captures[1]-(sends[0]+5),60)
        self.assertGreaterEqual(sends[1]-sends[0],60)
        if previous_completion is not None:
            self.assertGreaterEqual(captures[0]-previous_completion,60)

if __name__=="__main__":unittest.main()
