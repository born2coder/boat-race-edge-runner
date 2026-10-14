#!/usr/bin/env python3
"""Bounded writer: safety failures stop; public-read timeouts defer fresh capture."""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import edge_v2 as edge, prepare_forward
from scripts.edge_publication import DataPublisher

MIN_SEND_INTERVAL_SECONDS = 60
MAX_BATCH_ITEMS = 24
PUBLICATION_BACKOFF_SECONDS = 300

def confirm_or_defer(state, publisher):
    """Only public GET transport failures may recover, never ingestion failures.

    The failed batch is permanently excluded from forward delivery. A subsequent
    tick captures fresh observations instead of giving old odds a new receipt.
    """
    sent = set(state.get("forward_observations_sent", []))
    ignored = set(state.get("forward_observations_ignored", []))
    pending = {s["snapshot_id"] for r in state["races"].values()
               for s in r.get("snapshots", {}).values()
               if s["snapshot_id"] not in sent | ignored}
    # Results and idle heartbeats do not need another full-day public read.
    if not pending:
        return True
    try:
        receipt = edge.confirm_publication(state, publisher.revision)
    except (TimeoutError, urllib.error.URLError) as error:
        previous_wait = state.get("forward_publication_wait") or {}
        first_immutable_404 = (
            isinstance(error, urllib.error.HTTPError) and error.code == 404 and
            not (previous_wait.get("status") == "waiting" and
                 previous_wait.get("kind") == "HTTPError" and
                 previous_wait.get("http_status") == 404)
        )
        transient = (isinstance(error, TimeoutError) or
                     isinstance(getattr(error, "reason", None), TimeoutError) or
                     isinstance(error, urllib.error.HTTPError) and error.code in (502, 503, 504) or
                     first_immutable_404)
        if not transient:
            raise
        state.setdefault("forward_observations_ignored", []).extend(sorted(pending))
        now = edge.utcnow().isoformat()
        wait = state.setdefault("forward_publication_wait", {"first_seen_at": now})
        wait.update(status="waiting", checked_at=now, kind=type(error).__name__,
                    http_status=getattr(error, "code", None),
                    revision=publisher.revision,
                    failures=wait.get("failures", 0)+1,
                    skipped_observations=wait.get("skipped_observations", 0)+len(pending))
        print(json.dumps({"status": "publication_deferred", "kind": type(error).__name__,
                          "skippedObservations": len(pending),
                          "retryAfterSeconds": PUBLICATION_BACKOFF_SECONDS}), flush=True)
        return False
    publisher.acknowledge(receipt)
    wait = state.get("forward_publication_wait")
    if wait and wait.get("status") == "waiting":
        wait.update(status="ready", recovered_at=edge.utcnow().isoformat())
    return True

def operating_hours(now):
    # Midnight racing continues after 22:00. Keep the same daily safety caps.
    return 7 <= now.astimezone(prepare_forward.JST).hour < 24

def wait_for_send_slot(last_send):
    """Wait before capturing fresh observations, never after capturing them."""
    if last_send is not None:
        while (remaining := MIN_SEND_INTERVAL_SECONDS - (time.monotonic() - last_send)) > 0:
            time.sleep(remaining)

def http_failure_details(error, body):
    """Allowlisted evidence only: never persist raw HTML, credentials or payloads."""
    details = {"httpStatus": error.code,
               "observationCount": len(body["observations"]),
               "resultCount": len(body["results"])}
    try:
        response = json.loads(error.read(8192))
        if isinstance(response, dict) and response.get("status") in {
            "rate_limited", "busy", "paused", "flow_failed", "unauthorized",
            "invalid_payload", "payload_too_large", "replay_rejected", "recorded"}:
            details["responseStatus"] = response["status"]
    except Exception:
        pass  # Diagnostic extraction must never replace the original failure.
    for header, key in (("Retry-After", "retryAfter"), ("X-Vercel-Id", "requestId")):
        value = error.headers.get(header) if error.headers else None
        if value and len(value) <= 200 and all(32 <= ord(c) < 127 for c in value):
            details[key] = value
    return details

def observation_errors(state, since):
    """Keep the public-source failure evidence, never request credentials."""
    return [{"raceId": race["race_id"], "phase": phase,
             "at": error["at"], "reason": error["reason"][:180]}
            for race in state["races"].values()
            for phase, error in race.get("errors", {}).items()
            if edge.iso(error["at"]) >= since]

def check_observations(state, since, path):
    errors = observation_errors(state, since)
    if errors:
        quality_reasons = {"Official odds are stale or from the future",
                           "Official odds timestamp missing",
                           "Request completed outside its prospective window",
                           "Invalid odds"}
        fatal = []
        for error in errors:
            # A withdrawal leaves 5P3=60 prices; other missing prices also
            # invalidate only this observation. Never fabricate/renormalize
            # odds or retry the phase. Out-of-range odds likewise reject the
            # whole grid, not other races. Unknown failures still stop.
            incomplete = re.fullmatch(r"Official odds grid was incomplete: (\d{1,3})/120", error["reason"])
            if error["reason"] in quality_reasons or (incomplete and int(incomplete[1]) < 120):
                race = state["races"][edge.raw_id(error["raceId"])]
                race.setdefault("forward_skipped_phases", {}).setdefault(error["phase"],
                    {"at": error["at"], "reason": error["reason"]})
                print(json.dumps({"status": "observation_skipped", **error},
                                 ensure_ascii=False), flush=True)
            else:
                fatal.append(error)
        # Preserve the failed tick before raising; it is not a publication receipt.
        prepare_forward._atomic_json(path, state)
        if fatal:
            print(json.dumps({"status": "observation_failed", "errors": fatal},
                             ensure_ascii=False), flush=True)
            raise RuntimeError("Official observation failed; see saved race/phase diagnostics")

def payload(state, now):
    observations, results = [], []
    for race in state["races"].values():
        for snapshot in race.get("snapshots", {}).values():
            receipt = race.get("receipts", {}).get(snapshot["snapshot_id"])
            if (receipt and snapshot["snapshot_id"] not in state.get("forward_observations_sent", [])
                    and snapshot["snapshot_id"] not in state.get("forward_observations_ignored", [])
                    and 0 <= (now-edge.iso(receipt)).total_seconds() <= 25
                    and edge.iso(race["start_at"])>now
                    and edge.iso(edge.snapshot_deadline(race, snapshot))>now):
                observations.append({**{k: race[k] for k in (
                    "race_id", "race_date", "venue_code", "venue", "race_no", "start_at")},
                    "start_at": edge.snapshot_deadline(race, snapshot),
                    "snapshot": snapshot, "receipt": receipt})
        result = race.get("result")
        recorded_race = any(s["snapshot_id"] in state.get("forward_observations_sent", [])
                            for s in race.get("snapshots", {}).values())
        if result and recorded_race:
            key = result_key(race)
            confirmed = result.get("evidence", {}).get("obtained_at")
            if confirmed and not result_was_sent(race, state.get("forward_results_sent", [])):
                results.append({"raceId": race["race_id"], "result": {
                    "cancelled": bool(result.get("cancelled")),
                    "refundedLanes": result.get("refunded_lanes", []),
                    "combination": result.get("combination") or None,
                    "payoutPer100Yen": result.get("payout_per_100_yen"),
                    "unsupported": False, "confirmedAt": confirmed}})
    # The admission interval is per tick. Never silently sample or drop a cohort.
    if len(observations)>MAX_BATCH_ITEMS:
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
    return result_fingerprint(race["race_id"], {
        "combination": r.get("combination") or None,
        "payout_per_100_yen": r.get("payout_per_100_yen"),
        "refunded_lanes": sorted(r.get("refunded_lanes") or []),
        "cancelled": bool(r.get("cancelled"))})

def result_fingerprint(race_id, value):
    return race_id+":"+hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()

def result_was_sent(race, sent):
    # Accept old receipts without rewriting history: live pages omitted false,
    # while the daily archive explicitly stored it. These mean the same result.
    if result_key(race) in sent:
        return True
    r = race["result"]
    legacy = {k:r.get(k) for k in ("combination","payout_per_100_yen","refunded_lanes","cancelled")}
    for cancelled in ((True,) if r.get("cancelled") else (None, False)):
        legacy["cancelled"] = cancelled
        if result_fingerprint(race["race_id"], legacy) in sent:
            return True
    return False

def bound_results(body, previous_body=None):
    # Pending results remain in their day state until a successful send ACK.
    # Combine days before limiting so neither day has a separate 24-item quota.
    pending = body["results"] + (previous_body["results"] if previous_body else [])
    pending.sort(key=lambda r: (r["result"]["confirmedAt"], r["raceId"]))
    body["results"] = pending[:MAX_BATCH_ITEMS]
    if len(pending)>MAX_BATCH_ITEMS:
        print(json.dumps({"status":"settlement_backlog", "pending":len(pending),
                          "sending":MAX_BATCH_ITEMS}),flush=True)
    return body

def acknowledge_results(state, results):
    sent = state.setdefault("forward_results_sent", [])
    for row in results:
        race = state["races"].get(edge.raw_id(row["raceId"]))
        if race:
            key = result_key(race)
            if key not in sent:
                sent.append(key)

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
    try:
        with urllib.request.urlopen(request,timeout=35) as response:
            result = json.loads(response.read(8192))
    except urllib.error.HTTPError as error:
        error.forward_diagnostics = http_failure_details(error, body)
        print(json.dumps({"status": "forward_http_failed", **error.forward_diagnostics}), flush=True)
        raise
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
        started, last_send = time.monotonic(), None
        initialized = set()
        while time.monotonic()-started<315*60:
            now = edge.utcnow()
            if not operating_hours(now): return
            date = now.astimezone(prepare_forward.JST).date().isoformat()
            path = edge.STATE/"days"/(date+".json")
            state = json.loads(path.read_text()) if path.exists() else {
                "version":edge.VERSION,"date":date,"races":{},"started_at":now.isoformat()}
            if date not in initialized:
                if last_send is None and state.get("forward_last_send_completed_at"):
                    elapsed = max(0, (now-edge.iso(state["forward_last_send_completed_at"])).total_seconds())
                    last_send = time.monotonic()-elapsed
                # Old unsent snapshots are never replayed as fresh observations.
                state.setdefault("forward_observations_ignored",[]).extend(
                    s["snapshot_id"] for r in state["races"].values() for s in r.get("snapshots",{}).values()
                    if s["snapshot_id"] not in state.get("forward_observations_sent",[])
                    and s["snapshot_id"] not in state.get("forward_observations_ignored",[]))
                initialized.add(date)
            stage = "capture"
            try:
                wait_for_send_slot(last_send)
                if time.monotonic()-started >= 315*60: return
                tick = time.monotonic()
                now = edge.utcnow()
                if not operating_hours(now): return
                try:
                    observer.tick(state, max_observations=MAX_BATCH_ITEMS)
                except edge.RaceCardsPending:
                    checked_at = edge.utcnow().isoformat()
                    waiting = state.setdefault("forward_source_wait", {"first_seen_at": checked_at})
                    waiting.update(status="waiting", reason="race_cards_pending", checked_at=checked_at)
                    prepare_forward._atomic_json(path, state)
                    publisher.persist()
                    print(json.dumps({"status": "waiting", "reason": "race_cards_pending",
                                      "date": date, "retryAfterSeconds": 300}), flush=True)
                    if os.environ.get("RESEARCH_FORWARD_ONCE") == "1": return
                    # Refresh upstream on the next tick, within the existing run limit.
                    time.sleep(max(0, min(300, 315*60-(time.monotonic()-started))))
                    continue
                waiting = state.get("forward_source_wait")
                if waiting and waiting.get("status") == "waiting":
                    waiting.update(status="ready", recovered_at=edge.utcnow().isoformat())
                check_observations(state, now, path)
                stage = "persist_observations"
                prepare_forward._atomic_json(path,state); publisher.persist()
                stage = "public_readback"
                if not confirm_or_defer(state, publisher):
                    prepare_forward._atomic_json(path, state)
                    publisher.persist()
                    if os.environ.get("RESEARCH_FORWARD_ONCE") == "1": return
                    time.sleep(max(0, min(PUBLICATION_BACKOFF_SECONDS,
                                          315*60-(time.monotonic()-started))))
                    continue
                # Send receipt-fresh observations before result network work.
                body = payload(state,edge.utcnow())
                previous_path = edge.STATE/"days"/((now.astimezone(prepare_forward.JST).date()-timedelta(days=1)).isoformat()+".json")
                previous = json.loads(previous_path.read_text()) if previous_path.exists() else None
                # Only the preceding day's genuinely recorded cohort, no old archive replay.
                bound_results(body, payload(previous,edge.utcnow()) if previous else None)
                if body["observations"] or body["results"] or last_send is None or tick-last_send>=300:
                    stage = "ingestion"
                    send(body); last_send = time.monotonic()
                    state["forward_last_send_completed_at"] = edge.utcnow().isoformat()
                    state.setdefault("forward_observations_sent",[]).extend(
                        r["snapshot"]["snapshot_id"] for r in body["observations"])
                    acknowledge_results(state, body["results"])
                    if previous:
                        acknowledge_results(previous, body["results"])
                        prepare_forward._atomic_json(previous_path,previous)
                    # Persist delivery receipts before further result network work.
                    stage = "persist_delivery"
                    prepare_forward._atomic_json(path,state); publisher.persist()
                stage = "settlement"
                observer.settle(state)
                if previous:
                    pending = {rid:r for rid,r in previous["races"].items() if not r.get("result") and
                               any(s["snapshot_id"] in previous.get("forward_observations_sent",[])
                                   for s in r.get("snapshots",{}).values())}
                    if pending:
                        observer.settle({**previous,"races":pending})
                    prepare_forward._atomic_json(previous_path,previous)
                # No historical day scanning, legacy research API or final grids.
                stage = "persist_settlement"
                prepare_forward._atomic_json(path,state); publisher.persist()
            except Exception as error:
                prepare_forward._atomic_json(stop_path,{"at":edge.utcnow().isoformat(),
                    "kind":type(error).__name__,"stage":stage,"observationErrors":observation_errors(state,now),
                    **({"http": error.forward_diagnostics} if hasattr(error,"forward_diagnostics") else {}),
                    **({"git": error.edge_publication_diagnostics}
                       if hasattr(error,"edge_publication_diagnostics") else {})})
                try: publisher.persist()
                except Exception: pass
                print(json.dumps({"status":"stopped","kind":type(error).__name__}),flush=True)
                raise
            if os.environ.get("RESEARCH_FORWARD_ONCE")=="1": return
            time.sleep(max(1,60-(time.monotonic()-tick)))
        # Scheduled starts, not self-dispatch, continue healthy daytime operation.

if __name__=="__main__": main()

