import copy
import unittest
from unittest.mock import patch
from pathlib import Path

from scripts.edge_official import parse_preview, parse_result, archive_result, parse_schedule, fetch_preview_bundle

FIXTURES = Path(__file__).parent / "fixtures"
RACE = {"race_id": "BR:20260914:02:02", "race_date": "2026-09-14", "venue_code": "02", "race_no": 2,
        "start_time_jst": "11:16", "roster": [{"lane_no": i+1, "racer_id": rid}
          for i, rid in enumerate(["4555", "4388", "5313", "4363", "3692", "4846"])]}
EVIDENCE = {"obtained_at": "2026-09-14T02:00:00Z", "url": "fixture", "sha256": "fixture"}


class OfficialTests(unittest.TestCase):
    def setUp(self):
        self.preview = (FIXTURES / "official_20260914_0202_beforeinfo.html").read_text()
        self.result = (FIXTURES / "official_20260914_0202_raceresult.html").read_text()

    def test_six_lane_preview_matches_known_public_values(self):
        value = parse_preview(self.preview, RACE, EVIDENCE)
        self.assertEqual(value["tkz"]["艇1_体重(kg)"], 53.6)
        self.assertEqual(value["tkz"]["艇4_展示タイム"], 6.67)
        self.assertEqual(value["stt"]["艇5_スタート展示"], .31)
        self.assertEqual(value["sui"]["風向"], 2)
        self.assertEqual(value["sui"]["天候"], 1)
        self.assertEqual(value["sui"]["取得日時"], EVIDENCE["obtained_at"])

    def test_exhibition_flying_start_is_a_negative_time(self):
        value = parse_preview(self.preview.replace(">.08<", ">F.08<", 1), RACE, EVIDENCE)
        self.assertEqual(value["stt"]["艇1_スタート展示"], -.08)

    def test_schedule_is_available_even_when_exhibition_is_missing(self):
        html = self.preview.replace(">6.60<", "> <").replace(">11:16<", ">11:25<")
        with patch("scripts.edge_official.page", return_value=(html, EVIDENCE)) as fetch:
            value = fetch_preview_bundle(RACE)
        fetch.assert_called_once()
        self.assertEqual(value["deadlines"][2], "11:25")
        self.assertEqual(len(value["deadlines"]), 12)
        self.assertIsNone(value["preview"])
        self.assertEqual(value["error"], "Official numeric field missing")

    def test_schedule_rejects_wrong_identity_missing_and_invalid_clocks(self):
        for html in (self.preview.replace(">11:16<", "> <"),
                     self.preview.replace(">11:16<", ">25:99<"),
                     self.preview.replace(">11:16<", ">10:30<"),
                     self.preview.replace("rno=12&amp;jcd=02", "rno=12&amp;jcd=03")):
            with self.subTest(html=html[:40]):
                with self.assertRaises(ValueError):
                    parse_schedule(html, RACE)

    def test_wrong_race_date_or_roster_is_rejected(self):
        for field, value in [("race_date", "2026-09-13"), ("race_no", 3), ("venue_code", "03")]:
            race = copy.deepcopy(RACE); race[field] = value
            for parse, html in [(parse_preview, self.preview), (parse_result, self.result)]:
                with self.assertRaises(ValueError): parse(html, race, EVIDENCE)
        race = copy.deepcopy(RACE); race["roster"][0]["racer_id"] = "9999"
        with self.assertRaises(ValueError): parse_preview(self.preview, race, EVIDENCE)
        with self.assertRaises(ValueError): parse_result(self.result, race, EVIDENCE)

    def test_missing_preview_fields_never_become_zero(self):
        for html in [self.preview.replace(">6.60<", "> <"), self.preview.replace(">.08<", "> <")]:
            with self.assertRaises(ValueError): parse_preview(html, RACE, EVIDENCE)

    def test_verified_official_payout_and_winning_order(self):
        value = parse_result(self.result, RACE, EVIDENCE)
        self.assertEqual(value["combination"], "2-1-4")
        self.assertEqual(value["payout_per_100_yen"], 1270)
        self.assertEqual(len(value["finishers"]), 6)

    def test_no_payout_does_not_become_a_loss(self):
        with self.assertRaises(ValueError): parse_result(self.result.replace("¥1,270", ""), RACE, EVIDENCE)

    def test_archive_refund_and_no_trifecta(self):
        result = {"finishers": [{"lane_no": i, "result_code": "F"} for i in [1,2,3,5,6]]}
        value = archive_result(RACE["race_id"], result, EVIDENCE)
        self.assertTrue(value["cancelled"])
        self.assertEqual(value["refunded_lanes"], [1,2,3,5,6])
        self.assertIsNone(archive_result(RACE["race_id"], {"finishers": []}, EVIDENCE))
        result = {"combination": "1-2-4", "payout_per_100_yen": 1000,
                  "finishers": [{"lane_no": 3, "result_code": "K0"}]}
        self.assertEqual(archive_result(RACE["race_id"], result, EVIDENCE)["refunded_lanes"], [3])


if __name__ == "__main__": unittest.main()
