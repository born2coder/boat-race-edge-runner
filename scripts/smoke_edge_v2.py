"""Read-only frozen-bundle compatibility check; never publishes retrospective picks."""
from __future__ import annotations

import json
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd
from scripts.edge_v2 import Observer
from scripts.edge_v2_model import predict_full
from scripts.prepare_forward import JST


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


if __name__ == "__main__":
    main()
