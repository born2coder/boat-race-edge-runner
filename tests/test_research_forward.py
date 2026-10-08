import copy
import unittest
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
    def test_send_refuses_unreviewed_destination_before_network(self):
        with patch.dict(flow.os.environ,{"EDGE_SITE_INGEST_ENDPOINT":"https://other.example/api/internal/ingest"}):
            with patch.object(flow.urllib.request,"urlopen") as network:
                with self.assertRaises(RuntimeError):flow.send({})
                network.assert_not_called()

if __name__=="__main__":unittest.main()
