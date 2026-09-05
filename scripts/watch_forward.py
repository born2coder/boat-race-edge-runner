#!/usr/bin/env python3
"""Keep checking while a runner is alive instead of trusting cron precision."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import prepare_forward

ROOT = Path(__file__).resolve().parents[1]
POLL_SECONDS = 60
MAX_SECONDS = 345 * 60  # Leave time for setup/cleanup below GitHub's six-hour limit.


def check_mode(state: dict | None, now: datetime) -> str:
    if state is None:
        if now.time() > prepare_forward.MORNING_LOCK_DEADLINE:
            return "finished"
        return "check" if now.hour >= 6 else "idle"
    if state.get("pending_reassessment_ids") or state.get("published_count", 0) < len(state["selected"]):
        return "check"
    remaining = [datetime.fromisoformat(item["race"]["start_at"]) for item in state["selected"]
                 if not item.get("reassessment_published_at") and not item.get("reassessment_expired_at")
                 and datetime.fromisoformat(item["race"]["start_at"]) - timedelta(minutes=5) > now]
    if not remaining:
        return "finished"
    return "check" if min(remaining) - timedelta(minutes=30) <= now else "idle"


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=ROOT, check=True, timeout=120)


def persist_state(path: Path, message: str) -> None:
    run("git", "add", "--", str(path.relative_to(ROOT)))
    changed = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode
    if changed not in (0, 1):
        raise RuntimeError("Could not inspect pending state changes")
    if changed:
        run("git", "commit", "-m", message)
    # Also retry an already committed but previously unpushed lock.
    run("git", "pull", "--rebase", "origin", "main")
    run("git", "push", "origin", "HEAD:main")


def publish_pending(state_path: Path) -> None:
    payload = ROOT / ".runtime" / "payload.json"
    if not payload.exists():
        return
    persist_state(state_path, "Lock forward predictions and exhibition assessment")
    run(sys.executable, "scripts/send_payload.py", str(payload))
    run(sys.executable, "scripts/mark_published.py", str(state_path))
    persist_state(state_path, "Record forward publication")
    payload.unlink(missing_ok=True)


def main() -> None:
    # Sustained polling is intentionally restricted to the existing free public
    # standard runner. Making this repository private cannot silently incur hours.
    if os.environ.get("EDGE_REPOSITORY_VISIBILITY") != "public":
        raise RuntimeError("Continuous publication requires a public repository")
    date = datetime.now(prepare_forward.JST).date().isoformat()
    os.environ["EDGE_SERVICE_DATE"] = date
    state_path = ROOT / "state" / prepare_forward.MODEL_VERSION / f"{date}.json"
    run("git", "config", "user.name", "boat-race-edge-bot")
    run("git", "config", "user.email", "actions@users.noreply.github.com")
    started = time.monotonic()
    failures = 0
    first_check = True
    with tempfile.TemporaryDirectory(prefix="edge-watch-") as session:
        while time.monotonic() - started < MAX_SECONDS:
            now = datetime.now(prepare_forward.JST)
            if now.date().isoformat() != date or now.hour >= 22:
                break
            state = json.loads(state_path.read_text()) if state_path.exists() else None
            mode = check_mode(state, now)
            if first_check and state is not None and mode == "idle":
                mode = "check"  # Validate source/model access immediately on startup.
            print(json.dumps({"watch_checked_at": now.isoformat(), "mode": mode}), flush=True)
            if mode == "finished":
                break
            if mode == "check":
                try:
                    prepare_forward.main(Path(session))
                    publish_pending(state_path)
                    failures = 0
                    first_check = False
                except Exception as error:
                    failures += 1
                    print(json.dumps({"watch_error": type(error).__name__, "consecutive_failures": failures}), flush=True)
                    if failures >= 5:
                        raise
            time.sleep(POLL_SECONDS)
    print(json.dumps({"watch_finished_at": datetime.now(prepare_forward.JST).isoformat()}), flush=True)


if __name__ == "__main__":
    main()
