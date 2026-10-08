#!/usr/bin/env python3
"""Bounded prospective writer. A failed run persists a stop, never chains a retry."""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import secrets
import sys
import tempfile
import time
import urllib.request
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import edge_v2 as edge, prepare_forward
from scripts.edge_publication import DataPublisher

def payload(state, now):
    observations, results = [], []
    for race in state["races"].values():
        for snapshot in race.get("snapshots", {}).values():
            receipt = race.get("receipts", {}).get(snapshot["snapshot_id"])
            if (receipt and snapshot["snapshot_id"] not in state.get("forward_observations_sent", [])
                    and snapshot["snapshot_id"] not in state.get("forward_observations_ignored", [])
                    and 0 <= (now-edge.iso(receipt)).total_seconds() <= 25
                    and edge.iso(race["start_at"])>now):
                observations.append({**{k: race[k] for k in (
                    "race_id", "race_date", "venue_code", "venue", "race_no", "start_at")},
                    "snapshot": snapshot, "receipt": receipt})
        result = race.get("result")
        recorded_race = any(s["snapshot_id"] in state.get("forward_observations_sent", [])
                            for s in race.get("snapshots", {}).values())
        if result and recorded_race:
            key = result_key(race)
            confirmed = result.get("evidence", {}).get("obtained_at")
            if confirmed and key not in state.get("forward_results_sent", []):
                results.append({"raceId": race["race_id"], "result": {
                    "cancelled": bool(result.get("cancelled")),
                    "refundedLanes": result.get("refunded_lanes", []),
                    "combination": result.get("combination") or None,
                    "payoutPer100Yen": result.get("payout_per_100_yen"),
                    "unsupported": False, "confirmedAt": confirmed}})
    # The admission interval is per tick. Never silently sample or drop a cohort.
    if len(observations)>24 or len(results)>24:
        raise RuntimeError("Forward batch exceeds the reviewed limit")
    races = list(state["races"].values())
    cancelled = sum(bool(r.get("result", {}).get("cancelled")) for r in races)
    ended = sum(bool(r.get("result")) and not r["result"].get("cancelled") for r in races)
    confirming = sum(not r.get("result") and edge.iso(r["start_at"])<=now for r in races)
    return {"date": state["date"], "observations": observations, "results": results,
            "progress": {"ended": ended, "remaining": len(races)-ended-cancelled,
                         "confirming": confirming, "cancelled": cancelled}}

def result_key(race):
    r = race["result"]
    # A new fetch timestamp does not republish an unchanged official result.
    return race["race_id"]+":"+hashlib.sha256(json.dumps(
        {k:r.get(k) for k in ("combination","payout_per_100_yen","refunded_lanes","cancelled")},
        sort_keys=True).encode()).hexdigest()

def send(body):
    configured = urlsplit(os.environ["EDGE_SITE_INGEST_ENDPOINT"])
    if configured.scheme!="https" or configured.hostname!="boat-race-edge-runner.vercel.app":
        raise RuntimeError("Unreviewed forward destination")
    endpoint = urlunsplit((configured.scheme,configured.netloc,"/api/internal/research-forward","",""))
    raw = json.dumps(body,ensure_ascii=False,separators=(",",":"),sort_keys=True).encode()
    if len(raw)>512000: raise RuntimeError("Forward payload exceeds byte limit")
    timestamp, nonce = str(int(time.time())), secrets.token_hex(16)
    sig = hmac.new(os.environ["EDGE_SITE_INGEST_SECRET"].encode(),
                   timestamp.encode()+b"."+nonce.encode()+b"."+raw,hashlib.sha256).hexdigest()
    request = urllib.request.Request(endpoint,data=raw,method="POST",headers={
        "Content-Type":"application/json","X-Edge-Timestamp":timestamp,
        "X-Edge-Nonce":nonce,"X-Edge-Signature":sig})
    with urllib.request.urlopen(request,timeout=35) as response:
        result = json.loads(response.read(8192))
    if result.get("status")!="recorded": raise RuntimeError("Forward flow is paused")
    print(json.dumps({k:result[k] for k in ("status","entries","settled","cpuMs")}),flush=True)

def main():
    if os.environ.get("EDGE_REPOSITORY_VISIBILITY")!="public":
        raise RuntimeError("Public runner required")
    os.environ["EDGE_RESEARCH_FORWARD"] = "1"
    DataPublisher.git(edge.ROOT,"config","user.name","boat-race-edge-bot")
    DataPublisher.git(edge.ROOT,"config","user.email","actions@users.noreply.github.com")
    with tempfile.TemporaryDirectory(prefix="research-forward-") as folder:
        publisher = DataPublisher(edge.ROOT,Path(folder)/"data")
        publisher.ready = True  # New writer never mirrors data into deployable main.
        stop_path = edge.STATE/"forward-paused.json"
        if stop_path.exists():
            print('{"status":"paused","reason":"persistent_failure_stop"}',flush=True)
            return
        observer = edge.Observer(Path(folder))
        started, last_send = time.monotonic(), 0.0
        initialized = set()
        while time.monotonic()-started<315*60:
            tick = time.monotonic()
            now = edge.utcnow()
            if not 7<=now.astimezone(prepare_forward.JST).hour<22: return
            date = now.astimezone(prepare_forward.JST).date().isoformat()
            path = edge.STATE/"days"/(date+".json")
            state = json.loads(path.read_text()) if path.exists() else {
                "version":edge.VERSION,"date":date,"races":{},"started_at":now.isoformat()}
            if date not in initialized:
                # Old unsent snapshots are never replayed as fresh observations.
                state.setdefault("forward_observations_ignored",[]).extend(
                    s["snapshot_id"] for r in state["races"].values() for s in r.get("snapshots",{}).values()
                    if s["snapshot_id"] not in state.get("forward_observations_sent",[])
                    and s["snapshot_id"] not in state.get("forward_observations_ignored",[]))
                initialized.add(date)
            try:
                observer.tick(state)
                if any(edge.iso(e["at"])>=now for r in state["races"].values() for e in r.get("errors",{}).values()):
                    raise RuntimeError("Official observation failed")
                prepare_forward._atomic_json(path,state); publisher.persist()
                publisher.acknowledge(edge.confirm_publication(state,publisher.revision))
                # Send receipt-fresh observations before result network work.
                body = payload(state,edge.utcnow())
                previous_path = edge.STATE/"days"/((now.astimezone(prepare_forward.JST).date()-timedelta(days=1)).isoformat()+".json")
                previous = json.loads(previous_path.read_text()) if previous_path.exists() else None
                if previous:
                    # Only the preceding day's genuinely recorded cohort, no old archive replay.
                    previous_body = payload(previous,edge.utcnow())
                    body["results"].extend(previous_body["results"])
                    if len(body["results"])>24: raise RuntimeError("Settlement batch limit")
                if body["observations"] or body["results"] or tick-last_send>=300:
                    send(body); last_send = tick
                    state.setdefault("forward_observations_sent",[]).extend(
                        r["snapshot"]["snapshot_id"] for r in body["observations"])
                    state.setdefault("forward_results_sent",[]).extend(
                        result_key(state["races"][edge.raw_id(r["raceId"])]) for r in body["results"]
                        if edge.raw_id(r["raceId"]) in state["races"])
                    if previous:
                        previous.setdefault("forward_results_sent",[]).extend(
                            result_key(previous["races"][edge.raw_id(r["raceId"])]) for r in body["results"]
                            if edge.raw_id(r["raceId"]) in previous["races"])
                observer.settle(state)
                if previous:
                    pending = {rid:r for rid,r in previous["races"].items() if not r.get("result") and
                               any(s["snapshot_id"] in previous.get("forward_observations_sent",[])
                                   for s in r.get("snapshots",{}).values())}
                    if pending:
                        observer.settle({**previous,"races":pending})
                    prepare_forward._atomic_json(previous_path,previous)
                # No historical day scanning, legacy research API or final grids.
                prepare_forward._atomic_json(path,state); publisher.persist()
            except Exception as error:
                prepare_forward._atomic_json(stop_path,{"at":edge.utcnow().isoformat(),"kind":type(error).__name__})
                try: publisher.persist()
                except Exception: pass
                print(json.dumps({"status":"stopped","kind":type(error).__name__}),flush=True)
                raise
            if os.environ.get("RESEARCH_FORWARD_ONCE")=="1": return
            time.sleep(max(1,60-(time.monotonic()-tick)))
        # Scheduled starts, not self-dispatch, continue healthy daytime operation.

if __name__=="__main__": main()
