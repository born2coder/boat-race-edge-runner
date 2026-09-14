#!/usr/bin/env python3
"""Single writer, regular heartbeat, direct continuation before runner lifetime ends."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import timedelta
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import edge_v2 as edge
from scripts import prepare_forward
from scripts.edge_publication import DataPublisher

POLL_SECONDS = 60
MAX_SECONDS = 315 * 60
publisher = None


def git(*args):
    return subprocess.run(["git", *args], cwd=edge.ROOT, check=True, capture_output=True, text=True, timeout=90)


def persist():
    if publisher is not None:
        return publisher.persist()
    git("add", "--", "state/edge_v2")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=edge.ROOT).returncode == 1:
        git("commit", "-m", "Record full120 EDGE observations and publication receipts")
    # Normal fast-forward/rebase only. Never force-push over another stream.
    git("pull", "--rebase", "origin", "main")
    git("push", "origin", "HEAD:main")


def continue_observer():
    token, repo = os.environ.get("GH_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        raise RuntimeError("Observer continuation configuration missing")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/actions/workflows/edge.yml/dispatches",
        data=b'{"ref":"main"}', method="POST",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 204:
            raise RuntimeError("Observer continuation not accepted")


def main():
    global publisher
    if os.environ.get("EDGE_REPOSITORY_VISIBILITY") != "public":
        raise RuntimeError("Public observation repository required")
    git("config", "user.name", "boat-race-edge-bot")
    git("config", "user.email", "actions@users.noreply.github.com")
    started = time.monotonic()
    state = None
    failures = 0
    recovery_cursor = 0
    night_ticks = 0
    next_night_settlement = 0
    # Keep the process alive overnight so morning does not depend on cron delivery.
    with tempfile.TemporaryDirectory(prefix="edge-v2-") as folder:
        publisher = DataPublisher(edge.ROOT, Path(folder) / "public-data")
        observer = edge.Observer(Path(folder))
        while time.monotonic() - started < MAX_SECONDS:
            tick = time.monotonic()
            now_jst = edge.utcnow().astimezone(prepare_forward.JST)
            if not 7 <= now_jst.hour < 22 and tick < next_night_settlement:
                time.sleep(POLL_SECONDS)
                continue
            date = now_jst.date().isoformat()
            if state is None or state["date"] != date:
                path = edge.STATE / "days" / (date + ".json")
                state = json.loads(path.read_text()) if path.exists() else {
                    "version": edge.VERSION, "date": date, "races": {}, "started_at": edge.utcnow().isoformat()}
            try:
                # Carry the previous tick's successful receipt into the next durable write.
                if 7 <= now_jst.hour < 22:
                    observer.tick(state)
                    edge.write_state(state)
                    persist()
                    publisher.acknowledge(edge.confirm_publication(state))
                observer.settle(state)
                # Each loop also revisits unfinished recent days (no retrospective forecasts).
                recovery_days = []
                for old in sorted((edge.STATE / "days").glob("*.json")):
                    if old.stem == date:
                        continue
                    previous = json.loads(old.read_text())
                    pending = any(r.get("snapshots") and (not r.get("result") or not r.get("final"))
                                  for r in previous["races"].values())
                    if pending and old.stem >= (now_jst.date() - timedelta(days=7)).isoformat():
                        recovery_days.append(previous)
                # One older day per tick; recovery must not accumulate minutes
                # of network waits before the next prospective observation.
                if recovery_days:
                    previous = recovery_days[recovery_cursor % len(recovery_days)]
                    recovery_cursor += 1
                    observer.settle(previous)
                    edge.write_state(previous)
                state["last_error"] = None
                state["last_settlement_at"] = edge.utcnow().isoformat()
                edge.write_state(state)
                persist()
                if not 7 <= now_jst.hour < 22:
                    publisher.acknowledge(edge.confirm_publication(state))
                    edge.write_state(state)
                    persist()
                failures = 0
            except Exception as error:
                failures += 1
                state["last_error"] = {"at": edge.utcnow().isoformat(), "kind": type(error).__name__}
                # Avoid printing model contents, credentials, or HTTP response bodies.
                print(json.dumps({"edge_v2_error": type(error).__name__, "consecutive": failures}), flush=True)
                try:
                    edge.write_state(state)
                    persist()
                except Exception:
                    pass
                if failures >= 5:
                    continue_observer()
                    raise
            if not 7 <= now_jst.hour < 22:
                if not failures:
                    night_ticks += 1
                    pending = any(r.get("snapshots") and (not r.get("result") or
                        (not r["result"].get("cancelled") and not r.get("final"))) for r in state["races"].values())
                    if not pending or night_ticks >= 25:
                        next_night_settlement = time.monotonic() + 900
                        time.sleep(POLL_SECONDS)
                    continue
                # A deployment can briefly leave the new read routes unavailable.
                # Do not silently declare that night-time recovery succeeded.
                time.sleep(5)
                continue
            time.sleep(max(1, POLL_SECONDS - (time.monotonic() - tick)))
        else:
            # Queue the successor directly; do not wait for a potentially late cron.
            continue_observer()


if __name__ == "__main__":
    main()
