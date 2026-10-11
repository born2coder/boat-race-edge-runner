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

class RaceCardReadinessTests(unittest.TestCase):
    def test_missing_and_header_only_cards_wait_but_malformed_cards_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            path=flow.prepare_forward._day_path(root,"programs/race_cards","2026-10-12")
            with self.assertRaises(flow.edge.RaceCardsPending):
                flow.edge.require_race_cards(root,"2026-10-12")
            path.parent.mkdir(parents=True)
            path.write_text("レースコード,レース日\n",encoding="utf-8")
            with self.assertRaises(flow.edge.RaceCardsPending):
                flow.edge.require_race_cards(root,"2026-10-12")
            path.write_text("unexpected\nvalue\n",encoding="utf-8")
            with self.assertRaises(ValueError):
                flow.edge.require_race_cards(root,"2026-10-12")
            path.write_text("レースコード,レース日\n202610120101,2026-10-12\n",encoding="utf-8")
            flow.edge.require_race_cards(root,"2026-10-12")

    def test_pending_cards_are_checked_before_model_download(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            with patch.object(flow.prepare_forward,"_clone_data",return_value=root), \
                 patch.object(flow.prepare_forward,"_download_model") as download:
                with self.assertRaises(flow.edge.RaceCardsPending):
                    flow.edge.Observer(root).load("2026-10-12")
                download.assert_not_called()

    def run_flow(self, *, once=False, failure=None, exhaust=False):
        clock=[0.0]; ticks=[]; saves=[]
        base=datetime(2026,10,12,7,30,tzinfo=flow.prepare_forward.JST)
        class Publisher:
            revision="a"*40
            def __init__(self,*args): pass
            @staticmethod
            def git(*args): pass
            def acknowledge(self,*args): pass
            def persist(self): saves.append(clock[0])
        class Observer:
            def __init__(self,*args): pass
            def tick(self,state,max_observations=None):
                ticks.append(clock[0])
                assert max_observations == 24
                if failure: raise failure
                if len(ticks)==1:
                    if exhaust: clock[0]=315*60-2
                    raise flow.edge.RaceCardsPending("No race cards for 2026-10-12")
                # End the test after the first successful live tick.
                flow.os.environ["RESEARCH_FORWARD_ONCE"]="1"
            def settle(self,state): pass
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            with patch.dict(flow.os.environ,{"EDGE_REPOSITORY_VISIBILITY":"public",
                                            "RESEARCH_FORWARD_ONCE":"1" if once else "0"}), \
                 patch.object(flow.edge,"STATE",root),patch.object(flow,"DataPublisher",Publisher), \
                 patch.object(flow.edge,"Observer",Observer), \
                 patch.object(flow.edge,"utcnow",side_effect=lambda:base+timedelta(seconds=clock[0])), \
                 patch.object(flow.edge,"confirm_publication",return_value={}), \
                 patch.object(flow.time,"monotonic",side_effect=lambda:clock[0]), \
                 patch.object(flow.time,"sleep",side_effect=lambda delay:clock.__setitem__(0,clock[0]+delay)), \
                 patch.object(flow,"send") as send,patch("builtins.print"):
                if failure:
                    with self.assertRaises(type(failure)): flow.main()
                else: flow.main()
            day=root/"days/2026-10-12.json"
            return {"ticks":ticks,"clock":clock[0],"saves":saves,"send_count":send.call_count,
                    "day":json.loads(day.read_text()) if day.exists() else None,
                    "paused":(root/"forward-paused.json").exists()}

    def test_wait_then_arrival_resumes_without_pause_or_synthetic_predictions(self):
        result=self.run_flow()
        self.assertEqual(result["ticks"],[0,300])
        self.assertEqual(result["send_count"],1)
        self.assertFalse(result["paused"])
        self.assertEqual(result["day"]["races"],{})
        self.assertEqual(result["day"]["forward_source_wait"]["status"],"ready")
        self.assertIn("forward_last_send_completed_at",result["day"])

    def test_once_wait_does_not_send_or_loop(self):
        result=self.run_flow(once=True)
        self.assertEqual(result["ticks"],[0])
        self.assertEqual(result["send_count"],0)
        self.assertEqual(result["saves"],[0])
        self.assertFalse(result["paused"])
        self.assertEqual(result["day"]["forward_source_wait"]["status"],"waiting")

    def test_wait_cannot_extend_run_budget(self):
        result=self.run_flow(exhaust=True)
        self.assertEqual(result["clock"],315*60)
        self.assertEqual(result["ticks"],[0])
        self.assertEqual(result["send_count"],0)

    def test_unknown_errors_keep_persistent_stop(self):
        for error in (RuntimeError("unrecognized loader failure"),
                      flow.urllib.error.HTTPError("https://example.test",503,"unavailable",None,None)):
            with self.subTest(error=type(error).__name__):
                result=self.run_flow(failure=error)
                self.assertTrue(result["paused"])
                self.assertEqual(result["ticks"],[0])
                self.assertEqual(result["send_count"],0)

class ForwardPayloadTests(unittest.TestCase):
    def test_operating_hours_include_midnight_races_but_stop_at_day_boundary(self):
        for hour, expected in [(6, False), (7, True), (21, True), (22, True), (23, True), (0, False)]:
            now = datetime(2026, 10, 9, hour, 59, tzinfo=flow.prepare_forward.JST)
            self.assertEqual(flow.operating_hours(now), expected)

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
        for reason in ("Official odds grid was incomplete: 121/120", "Unexpected odds format",
                       "Model combination ordering differs"):
            with self.subTest(reason=reason),tempfile.TemporaryDirectory() as folder,patch("builtins.print"):
                self.race["errors"]={"t15":{"at":self.now.isoformat(),"reason":reason}}
                with self.assertRaises(RuntimeError):
                    flow.check_observations(self.state,self.now,Path(folder)/"day.json")

    def test_invalid_odds_reject_whole_phase_without_losing_healthy_race(self):
        bad=copy.deepcopy(self.race)
        bad["race_id"]="BR:20261008:08:03"
        bad["snapshots"]={}
        bad["errors"]={"t15":{"at":self.now.isoformat(),"reason":"Invalid odds",
            "evidence":{"invalid_count":1,"invalid_samples":[{"combination":"1-2-3","value":"0.0"}]}}}
        self.state["races"]["202610080803"]=bad
        with tempfile.TemporaryDirectory() as folder,patch("builtins.print"):
            path=Path(folder)/"day.json"
            flow.check_observations(self.state,self.now,path)
            saved=json.loads(path.read_text())
        self.assertIsNone(flow.edge.phase_due(bad,self.now))
        self.assertEqual(flow.edge.phase_due(bad,self.now+timedelta(minutes=5)),"t10")
        self.assertEqual([o["snapshot"]["snapshot_id"] for o in flow.payload(saved,self.now)["observations"]],["new"])
        self.assertEqual(saved["races"]["202610080803"]["errors"],bad["errors"])
        self.assertEqual(bad["snapshots"],{})

    def test_fetch_grid_rejects_invalid_values_with_bounded_public_evidence(self):
        from itertools import permutations
        from unittest.mock import MagicMock
        combos=["-".join(map(str,p)) for p in permutations(range(1,7),3)]
        for value in (0.0,-1.0,100001.0,float("nan"),float("inf")):
            with self.subTest(value=value):
                odds=dict.fromkeys(combos,10.0)
                odds.update(dict.fromkeys(combos[:7],value))
                response=MagicMock()
                response.__enter__.return_value.read.return_value=b"public odds fixture"
                with patch.object(flow.edge.urllib.request,"urlopen",return_value=response) as network, \
                     patch.object(flow.edge.edge_shadow,"parse_odds_html",return_value=(odds,"10:36")):
                    with self.assertRaises(flow.edge.InvalidOfficialOdds) as raised:
                        flow.edge.fetch_grid(self.race)
                network.assert_called_once()
                evidence=raised.exception.evidence
                self.assertEqual(evidence["invalid_count"],7)
                self.assertEqual(len(evidence["invalid_samples"]),5)
                self.assertEqual(len(evidence["source_sha256"]),64)
                self.assertEqual(str(raised.exception),"Invalid odds")

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

