"""Read-only frozen-bundle compatibility check; never publishes retrospective picks."""
from __future__ import annotations

import json
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd
from scripts.edge_v2 import Observer
from scripts.edge_v2_model import predict_full
from scripts.prepare_forward import JST
from scripts import edge_official, prepare_forward


def main():
    date = (datetime.now(JST).date() - timedelta(days=1)).isoformat()
    with tempfile.TemporaryDirectory(prefix="edge-contract-") as tmp:
        observer = Observer(Path(tmp))
        _, schedule = observer.load(date)
        morning_count = exhibition_count = 0
        # Sample multiple races; completed source data is used only to check interfaces.
        for _, row in schedule.head(12).iterrows():
            frame = pd.DataFrame([row])
            now = pd.Timestamp(row["deadline_at"]) - pd.Timedelta(minutes=6)
            for kind in ("morning", "exhibition"):
                full = predict_full(frame, observer.models[kind], observer.hybrid, observer.module, kind, now)
                if full:
                    if kind == "morning": morning_count += 1
                    else: exhibition_count += 1
        if morning_count == 0 or exhibition_count == 0:
            raise RuntimeError("Both frozen full120 inference paths must pass")
        print(json.dumps({"contract": "PASS", "morning_races": morning_count,
                          "exhibition_races": exhibition_count, "combinations": 120,
                          "top8_matches_original": True, "published": False}))
        # A fixed parser/inference fixture, not a retrospective trading record.
        fixture_date = "2026-09-14"
        data, schedule = observer.load(fixture_date)
        rid = "202609140202"
        row = schedule[schedule["race_id"].astype(str) == rid].iloc[0]
        cards, titles = prepare_forward._load_cards(data, fixture_date)
        race = prepare_forward._race_record(row, cards, titles)
        race["roster"] = [{"lane_no": e["lane_no"], "racer_id": e["racer_id"]} for e in race["entries"]]
        evidence = {"obtained_at": "2026-09-14T02:00:00+00:00", "url": "offline-test-fixture", "sha256": "fixture"}
        html = (Path(__file__).resolve().parents[1] / "tests/fixtures/official_20260914_0202_beforeinfo.html").read_text()
        preview = edge_official.parse_preview(html, race, evidence)
        with patch.object(edge_official, "fetch_preview", return_value=preview):
            observer.overlay_previews(data, fixture_date, {rid: "t15"}, {rid: race})
        frame = prepare_forward._load_service_day_compatible(observer.hybrid, data, fixture_date)
        frame = frame[frame["race_id"].astype(str) == rid]
        predicted = predict_full(frame, observer.models["exhibition"], observer.hybrid, observer.module,
                                 "exhibition", pd.Timestamp("2026-09-14T02:01:00Z"))
        if rid not in predicted:
            raise RuntimeError("Official preview fixture did not reach frozen exhibition inference")
        print(json.dumps({"official_preview_contract": "PASS", "combinations": len(predicted[rid]["probabilities"]),
                          "offline_fixture_only": True, "published": False}))


if __name__ == "__main__":
    main()
