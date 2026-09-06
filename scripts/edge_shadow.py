#!/usr/bin/env python3
"""Take one auditable pre-deadline odds snapshot for every race and find EDGE candidates."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import nullcontext
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import prepare_forward

ROOT = Path(__file__).resolve().parents[1]
STATE_SCHEMA = "boat-race-edge-shadow-state/v1"
RECORD_THRESHOLD = 150.0
PUBLIC_THRESHOLD = 150.0
WINDOW_OPEN_MINUTES = 25
WINDOW_CLOSE_MINUTES = 17
ODDS_URL = "https://www.boatrace.jp/owpc/pc/race/odds3t?hd={date}&jcd={venue:02d}&rno={race_no}"


class TrifectaOddsParser(HTMLParser):
    """Parse the official 6 x 20 trifecta odds grid, including rowspan cells."""

    def __init__(self) -> None:
        super().__init__()
        self._saw_title = False
        self._in_target_table = False
        self._in_tbody = False
        self._in_cell = False
        self._cell_attrs: dict[str, str] = {}
        self._cell_text: list[str] = []
        self._row: list[tuple[str, int]] = []
        self._rows: list[list[str]] = []
        self._spans: dict[int, tuple[int, str]] = {}
        self._page_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key: value or "" for key, value in attrs}
        if tag == "table" and self._saw_title and not self._in_target_table:
            self._in_target_table = True
        elif tag == "tbody" and self._in_target_table:
            self._in_tbody = True
        elif tag == "tr" and self._in_tbody:
            self._row = []
        elif tag == "td" and self._in_tbody:
            self._in_cell = True
            self._cell_attrs = attr
            self._cell_text = []

    def handle_data(self, data: str) -> None:
        value = data.strip()
        if value:
            self._page_text.append(value)
            if "3連単オッズ" in value:
                self._saw_title = True
            if self._in_cell:
                self._cell_text.append(value)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._in_cell:
            text = "".join(self._cell_text).strip()
            rowspan = int(self._cell_attrs.get("rowspan", "1") or "1")
            self._row.append((text, rowspan))
            self._in_cell = False
        elif tag == "tr" and self._in_tbody and self._row:
            grid = [""] * 18
            for column, (remaining, value) in list(self._spans.items()):
                grid[column] = value
                if remaining <= 1:
                    del self._spans[column]
                else:
                    self._spans[column] = (remaining - 1, value)
            column = 0
            for value, rowspan in self._row:
                while column < 18 and grid[column]:
                    column += 1
                if column >= 18:
                    break
                grid[column] = value
                if rowspan > 1:
                    self._spans[column] = (rowspan - 1, value)
                column += 1
            if all(grid):
                self._rows.append(grid)
            self._row = []
        elif tag == "tbody" and self._in_tbody:
            self._in_tbody = False
        elif tag == "table" and self._in_target_table:
            self._in_target_table = False

    def odds(self) -> dict[str, float]:
        result: dict[str, float] = {}
        for row in self._rows:
            for first in range(1, 7):
                offset = (first - 1) * 3
                second, third, raw = row[offset:offset + 3]
                if second.isdigit() and third.isdigit() and re.fullmatch(r"\d+(?:\.\d+)?", raw):
                    result[f"{first}-{second}-{third}"] = float(raw)
        return result

    def update_time(self) -> str | None:
        text = " ".join(self._page_text)
        match = re.search(r"オッズ更新時間\s*(\d{1,2}:\d{2})", text)
        return match.group(1) if match else None


def parse_odds_html(html: str) -> tuple[dict[str, float], str | None]:
    parser = TrifectaOddsParser()
    parser.feed(html)
    odds = parser.odds()
    if len(odds) != 120:
        raise ValueError(f"Official odds grid was incomplete: {len(odds)}/120")
    return odds, parser.update_time()


def fetch_odds(date: str, venue: int, race_no: int) -> tuple[dict[str, float], str | None]:
    url = ODDS_URL.format(date=date.replace("-", ""), venue=venue, race_no=race_no)
    request = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; FuneNoKotowariEdge/1.0; +https://boat-race-edge-runner.vercel.app/edge)",
        "Accept": "text/html,application/xhtml+xml",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return parse_odds_html(response.read().decode("utf-8"))


def _edge_id(race_id: str, combination: str) -> str:
    """Keep retries idempotent: one recorded candidate per race and combination."""
    raw = f"{race_id}|{combination}".encode()
    return "edge_" + hashlib.sha256(raw).hexdigest()[:24]


def _eligible(schedule, observed: set[str], now):
    import pandas as pd
    deadlines = pd.to_datetime(schedule["deadline_at"], errors="coerce", utc=True)
    minutes = (deadlines - now).dt.total_seconds() / 60
    return schedule.loc[
        ~schedule["race_id"].astype(str).isin(observed)
        & minutes.le(WINDOW_OPEN_MINUTES)
        & minutes.ge(WINDOW_CLOSE_MINUTES)
    ].copy()


def _candidate_rows(prediction, race: dict[str, Any], odds: dict[str, float], observed_at: str) -> list[dict[str, Any]]:
    candidates = []
    for rank in range(1, 9):
        combination = str(prediction[f"top{rank}_combo"])
        probability = float(prediction[f"top{rank}_score"])
        if not math.isfinite(probability) or probability <= 0 or probability > 1:
            raise ValueError(f"Invalid predicted probability for {combination}: {probability}")
        decimal = odds[combination]
        expected = probability * decimal * 100
        if expected < RECORD_THRESHOLD:
            continue
        candidates.append({
            "edge_id": _edge_id(race["race_id"], combination),
            "race_id": race["race_id"],
            "race_date": race["race_date"],
            "venue_name": race["venue"],
            "venue_code": race["venue_code"],
            "race_no": race["race_no"],
            "start_at": race["start_at"],
            "combination": combination,
            "predicted_probability": round(probability, 10),
            "odds_decimal": decimal,
            "expected_value_percent": round(expected, 2),
            "threshold_percent": PUBLIC_THRESHOLD,
            "observed_at": observed_at,
            "status": "open" if expected >= PUBLIC_THRESHOLD else "excluded",
        })
    return candidates


def prepare(session_root: Path | None = None) -> tuple[dict[str, Any] | None, dict[str, Any], Path]:
    import pandas as pd

    date = os.environ.get("EDGE_SERVICE_DATE") or datetime.now(prepare_forward.JST).date().isoformat()
    state_path = ROOT / "state" / "edge_shadow" / f"{date}.json"
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {
        "schema_version": STATE_SCHEMA, "date": date, "observations": {}, "candidates": [],
    }
    if state.get("schema_version") != STATE_SCHEMA or state.get("date") != date:
        raise RuntimeError("EDGE shadow state mismatch")

    with (nullcontext(session_root) if session_root else tempfile.TemporaryDirectory(prefix="edge-shadow-")) as temporary:
        temporary_root = Path(temporary)
        data_root = prepare_forward._clone_data(temporary_root / "boatracecsv", date)
        card_path = prepare_forward._day_path(data_root, "programs/race_cards", date)
        title_path = prepare_forward._day_path(data_root, "programs/title", date)
        if not card_path.exists() or not title_path.exists():
            return None, state, state_path

        encrypted = temporary_root / prepare_forward.MODEL_FILENAME
        plaintext = temporary_root / "W_morning_badge_v1.tar.gz"
        extracted = temporary_root / "model"
        if not extracted.exists():
            prepare_forward._download_model(encrypted)
            prepare_forward._decrypt_model(encrypted, plaintext)
            prepare_forward._safe_extract(plaintext, extracted)
            sys.path.insert(0, str(extracted))
        from edge_research import hybrid_forward
        from edge_research.hybrid_forward import load_frozen, predict_morning

        artifact_dir = extracted / "artifacts" / "frozen_w_morning_badge_v1"
        manifest, models, _, _ = load_frozen(artifact_dir)
        if date < manifest["genuine_forward_not_before"]:
            return None, state, state_path
        schedule = prepare_forward._load_service_day_compatible(hybrid_forward, data_root, date)
        now = pd.Timestamp(datetime.now(timezone.utc))
        eligible = _eligible(schedule, set(state["observations"]), now)
        if eligible.empty:
            return None, state, state_path

        predictions = predict_morning(schedule, models["morning"])
        by_id = {str(row.race_id): pd.Series(row._asdict()) for row in predictions.itertuples(index=False)}
        cards, titles = prepare_forward._load_cards(data_root, date)

        fetched: dict[str, tuple[dict[str, float], str | None] | Exception] = {}
        with ThreadPoolExecutor(max_workers=min(6, len(eligible))) as pool:
            futures = {
                pool.submit(fetch_odds, date, int(row.venue), int(row.race_number)): str(row.race_id)
                for row in eligible.itertuples(index=False)
            }
            for future in as_completed(futures):
                raw_id = futures[future]
                try:
                    fetched[raw_id] = future.result()
                except Exception as error:
                    fetched[raw_id] = error

        candidates: list[dict[str, Any]] = []
        races: dict[str, dict[str, Any]] = {}
        successful_ids: list[str] = []
        for _, frame in eligible.iterrows():
            raw_id = str(frame["race_id"])
            result = fetched[raw_id]
            if isinstance(result, Exception):
                print(json.dumps({"edge_fetch_error": raw_id, "error": type(result).__name__}), flush=True)
                continue
            odds, official_update = result
            race = prepare_forward._race_record(frame, cards, titles)
            observed_at = now.isoformat()
            rows = _candidate_rows(by_id[raw_id], race, odds, observed_at)
            candidates.extend(rows)
            races[race["race_id"]] = race
            successful_ids.append(raw_id)
            state["observations"][raw_id] = {
                "observed_at": observed_at,
                "official_update_time": official_update,
                "odds_count": len(odds),
                "recorded_candidates": len(rows),
                "public_candidates": sum(row["status"] == "open" for row in rows),
            }

        existing_candidates = {row["edge_id"]: row for row in state.get("candidates", [])}
        existing_candidates.update({row["edge_id"]: row for row in candidates})
        state["candidates"] = sorted(
            existing_candidates.values(),
            key=lambda row: (row["race_id"], -row["expected_value_percent"]),
        )

        if not successful_ids:
            return None, state, state_path
        generated_at = now.isoformat()
        artifact = prepare_forward._artifact(data_root, "programs/race_cards", "race_cards", date, generated_at)
        payload = {
            "schema_version": prepare_forward.PAYLOAD_SCHEMA,
            "generated_at": generated_at,
            "service_date": date,
            "summary": {
                "scheduled_races": int(len(schedule)),
                "predicted_races": int(len(schedule)),
                "incomplete_races": 0,
            },
            "artifacts": [artifact] if artifact else [],
            "races": list(races.values()),
            "decisions": [], "predictions": [], "reassessments": [],
            "edge_candidates": candidates,
            "results": [],
        }
        return payload, state, state_path


if __name__ == "__main__":
    payload, state, state_path = prepare()
    print(json.dumps({"payload": bool(payload), "state_path": str(state_path), "observations": len(state["observations"])}, ensure_ascii=False))
