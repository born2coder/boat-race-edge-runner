import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import boatcast_program as b, edge_v2


class BoatcastProgramTests(unittest.TestCase):
    def test_live_clock_and_six_lanes_produce_model_schema(self):
        venue = dict(RaceStudiumNo="01", RaceTitleAll=["一般", "予選"], DeadlineTimeAll=["確定", "15:40"],
                     CancelStatusAll=["", ""], HoldingTitle="開催", DailyTitle="初日", RaceGrade="一般", NighterFlag="0")
        with patch.object(b, "read", return_value=json.dumps({"res_cd": 0, "return_info": [venue]})):
            title, = b.titles("2026-11-18")
        self.assertEqual(title["レースコード"], "202611180102")
        rows = []
        for lane in range(6):
            row = [str(4000 + lane), "名称", "99期", "福 岡:東 京", "32", "A1", "", "F2", "", ".15",
                   "5.3", "36", "52", "5.2", "30", "40", "0", "35", "28", "40", "0", "21", "26", "40", "4R"]
            rows.append("\t".join(row + ["1,2,2,.13,２"] * 14))
        with patch.object(b, "read", return_value="data=\n1\t6\n" + "\n".join(rows)):
            card = b.card(title)
        self.assertEqual(set(card), set(b.COLUMNS))
        self.assertEqual([card[f"艇{i}_登録番号"] for i in range(1, 7)], [str(i) for i in range(4000, 4006)])
        self.assertEqual(card["艇6_節D7走2_着順"], "2")
        with patch.object(b, "read", return_value="data=\n1\t6\n" + "\n".join(rows[:5])):
            self.assertIsNone(b.card(title))
        with tempfile.TemporaryDirectory() as d, patch.object(b, "titles", return_value=[title]) as fetch, patch.object(b, "card", return_value=card):
            b.refresh(Path(d), "2026-11-18")
            b.refresh(Path(d), "2026-11-18")
            fetch.assert_called_once()
            edge_v2.require_race_cards(Path(d), "2026-11-18")
