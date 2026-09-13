#!/usr/bin/env python3
"""Full120 prospective observer; raw observations are immutable and versioned."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import edge_shadow, prepare_forward
from scripts.edge_v2_model import predict_full
from scripts.edge_v2_metrics import VERSION, PHASES, comparison, aggregate_days, snapshot_hash, iso

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "state" / "edge_v2"
SITE = "https://boat-race-edge-runner.vercel.app"
WINDOWS = {"t20": (25, 17), "t15": (17, 13), "t10": (12, 8)}


def utcnow():
    return datetime.now(timezone.utc)


def raw_id(value):
    return str(value).replace("BR:", "").replace(":", "")


def phase_due(race, now):
    minutes = (iso(race["start_at"]) - now).total_seconds() / 60
    return next((phase for phase, (high, low) in WINDOWS.items()
                 if low <= minutes <= high and phase not in race.get("snapshots", {})), None)


def fetch_grid(race):
    started = utcnow()
    url = edge_shadow.ODDS_URL.format(date=race["race_date"].replace("-", ""),
                                      venue=int(race["venue_code"]), race_no=race["race_no"])
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 FuneNoKotowari/2.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        html = response.read().decode("utf-8")
    odds, official = edge_shadow.parse_odds_html(html)
    finished = utcnow()
    if any(not 0 < value <= 100000 for value in odds.values()):
        raise ValueError("Invalid odds")
    return odds, {"request_started_at": started.isoformat(), "observed_at": finished.isoformat(),
                  "official_update_time": official, "source_sha256": prepare_forward._sha_bytes(html.encode())}


def capture(race, phase, grid, models, computed_at):
    odds, timing = grid
    observed = iso(timing["observed_at"])
    high, low = WINDOWS[phase]
    minutes = (iso(race["start_at"]) - observed).total_seconds() / 60
    if not low <= minutes <= high:
        raise ValueError("Request completed outside its prospective window")
    if not timing["official_update_time"]:
        raise ValueError("Official odds timestamp missing")
    # BOAT RACE emits single-digit morning hours, e.g. "8:18".
    official = datetime.strptime(race["race_date"] + " " + timing["official_update_time"] + " +0900", "%Y-%m-%d %H:%M %z")
    age = (observed - official).total_seconds()
    if age < -60 or age > 300:
        raise ValueError("Official odds are stale or from the future")
    morning = models["morning"]
    if morning is None:
        raise ValueError("Morning distribution missing")
    exhibition = models.get("exhibition")
    combos = morning["combinations"]
    if exhibition and exhibition["combinations"] != combos:
        raise ValueError("Model combination ordering differs")
    snapshot = {
        "version": VERSION, "race_id": race["race_id"], "phase": phase, **timing,
        "computed_at": computed_at, "minutes_before": minutes,
        "combinations": combos, "odds": [odds[c] for c in combos],
        "morning": morning["probabilities"],
        "exhibition": exhibition["probabilities"] if exhibition else None,
        "exhibition_source_ready_at": exhibition["source_ready_at"] if exhibition else None,
        "model_bundle_sha256": prepare_forward.MODEL_SHA256,
    }
    snapshot["snapshot_id"] = snapshot_hash(snapshot)
    # setdefault preserves the first observation across restarts/retries.
    race.setdefault("snapshots", {}).setdefault(phase, snapshot)
    return snapshot


def public_json(path):
    with urllib.request.urlopen(SITE + path, timeout=15) as response:
        return json.load(response)


def refresh_results(state):
    response = public_json("/api/edge/v2/results?date=" + state["date"])
    for result in response.get("results", []):
        race = state["races"].get(raw_id(result["race_id"]))
        if race:
            # Full-grid final odds and official payout are different evidence.
            if race.get("result") and race["result"] != result:
                race.setdefault("result_corrections", []).append({"previous": race["result"], "at": utcnow().isoformat()})
            race["result"] = result


def final_grid(race, grid):
    odds, timing = grid
    result = race.get("result")
    if not result or iso(timing["observed_at"]) <= iso(race["start_at"]):
        raise ValueError("Result is required before labeling final odds")
    # Never pass a still-moving pre-close grid off as confirmed odds.
    if abs(odds.get(result["combination"], -1) * 100 - result["payout_per_100_yen"]) > 0.01:
        raise ValueError("Closing grid does not match official winning payout")
    race.setdefault("final", {**timing, "odds": odds, "validation": "official-result-payout-match"})


def progress(state, now):
    races = list(state["races"].values())
    return {"scheduled": len(races), "checked": sum(bool(r.get("snapshots")) for r in races),
            "phases": {p: sum(p in r.get("snapshots", {}) for r in races) for p in PHASES},
            "missed": {p: sum(p not in r.get("snapshots", {}) and
                                 (iso(r["start_at"]) - now).total_seconds() / 60 < WINDOWS[p][1]
                                 for r in races) for p in PHASES},
            "final_grids": sum(bool(r.get("final")) for r in races),
            "results": sum(bool(r.get("result")) for r in races),
            "last_tick_at": state.get("last_tick_at"), "last_error": state.get("last_error")}


def write_state(state):
    path = STATE / "days" / (state["date"] + ".json")
    prepare_forward._atomic_json(path, state)
    summary = {"date": state["date"], "version": VERSION, "progress": progress(state, utcnow()),
               "comparison": comparison(list(state["races"].values()))}
    prepare_forward._atomic_json(STATE / "summaries" / (state["date"] + ".json"), summary)
    days = [json.loads(p.read_text()) for p in sorted((STATE / "summaries").glob("*.json"), reverse=True)]
    prepare_forward._atomic_json(STATE / "index.json", {"version": VERSION,
        "updated_at": utcnow().isoformat(), "days": [{"date": d["date"], "progress": d["progress"]} for d in days],
        "comparison": aggregate_days(days)})
    return path


def confirm_publication(state):
    """Record only IDs actually returned by the production read path."""
    receipt = public_json("/api/edge/v2/receipt?date=" + state["date"])
    confirmed = set(receipt.get("snapshot_ids", []))
    served = receipt.get("served_at")
    if not served or abs((utcnow() - iso(served)).total_seconds()) > 120:
        raise ValueError("Invalid production receipt time")
    for race in state["races"].values():
        for snapshot in race.get("snapshots", {}).values():
            if snapshot["snapshot_id"] in confirmed:
                race.setdefault("receipts", {}).setdefault(snapshot["snapshot_id"], served)


class Observer:
    def __init__(self, session):
        self.session = session
        self.models = None
        self.frozen_date = None

    def load(self, date):
        data = prepare_forward._clone_data(self.session / "boatracecsv", date)
        extracted = self.session / "model"
        if not extracted.exists():
            encrypted, plain = self.session / prepare_forward.MODEL_FILENAME, self.session / "model.tar.gz"
            prepare_forward._download_model(encrypted)
            prepare_forward._decrypt_model(encrypted, plain)
            prepare_forward._safe_extract(plain, extracted)
        if str(extracted) not in sys.path:
            sys.path.insert(0, str(extracted))
        from edge_research import hybrid_forward, models
        if self.models is None:
            self.manifest, self.models, _, _ = hybrid_forward.load_frozen(extracted / "artifacts/frozen_w_morning_badge_v1")
        self.hybrid, self.module = hybrid_forward, models
        if date < self.manifest["genuine_forward_not_before"]:
            raise ValueError("Date precedes model forward boundary")
        return data, prepare_forward._load_service_day_compatible(hybrid_forward, data, date)

    def tick(self, state):
        import pandas as pd
        data, schedule = self.load(state["date"])
        now = utcnow()
        cards, titles = prepare_forward._load_cards(data, state["date"])
        for _, frame in schedule.iterrows():
            raw = str(frame["race_id"])
            race = prepare_forward._race_record(frame, cards, titles)
            if raw not in state["races"]:
                # Keep missing/scratched races in coverage, but do not forecast them.
                state["races"][raw] = {k: v for k, v in race.items() if k != "entries"}
                state["races"][raw]["eligible_roster"] = prepare_forward._race_is_publishable(race)
                state["races"][raw]["snapshots"] = {}
            # Cards can become complete after the first schedule read.
            state["races"][raw]["eligible_roster"] = prepare_forward._race_is_publishable(race)
        due = {rid: phase_due(r, now) for rid, r in state["races"].items() if r.get("eligible_roster")}
        due = {rid: phase for rid, phase in due.items() if phase}
        morning, exhibition = {}, {}
        if due:
            frame = schedule[schedule["race_id"].astype(str).isin(due)].copy()
            morning = predict_full(frame, self.models["morning"], self.hybrid, self.module, "morning", pd.Timestamp(now))
            exhibition = predict_full(frame, self.models["exhibition"], self.hybrid, self.module, "exhibition", pd.Timestamp(now))
        computed_at = utcnow().isoformat()
        # Fetch pre-race snapshots first; result recovery must not delay them.
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = {pool.submit(fetch_grid, state["races"][rid]): rid for rid in due}
            for future in as_completed(futures):
                rid = futures[future]
                try:
                    capture(state["races"][rid], due[rid], future.result(),
                            {"morning": morning.get(rid), "exhibition": exhibition.get(rid)}, computed_at)
                    state["races"][rid].get("errors", {}).pop(due[rid], None)
                except Exception as error:
                    state["races"][rid].setdefault("errors", {})[due[rid]] = {"at": utcnow().isoformat(), "reason": str(error)[:180]}
        state["last_tick_at"] = utcnow().isoformat()
        state["last_error"] = None

    def settle(self, state):
        refresh_results(state)
        pending = [r for r in state["races"].values() if r.get("result") and not r.get("final") and r.get("snapshots")]
        # Bounded work; prioritize oldest overdue races, retry missing grids later.
        pending.sort(key=lambda r: r.get("final_attempt_at", ""))
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(fetch_grid, r): r for r in pending[:8]}
            for future in as_completed(futures):
                race = futures[future]
                race["final_attempt_at"] = utcnow().isoformat()
                try:
                    final_grid(race, future.result())
                    race.pop("final_error", None)
                except Exception as error:
                    race["final_error"] = str(error)[:180]
