#!/usr/bin/env python3
"""Run the independent EDGE shadow observer every three minutes."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import edge_shadow, prepare_forward

ROOT = Path(__file__).resolve().parents[1]
POLL_SECONDS = 180
MAX_SECONDS = 345 * 60


def run(*args: str) -> None:
    subprocess.run(args, cwd=ROOT, check=True, timeout=180)


def persist(path: Path) -> None:
    run("git", "add", "--", str(path.relative_to(ROOT)))
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 1:
        run("git", "commit", "-m", "Record EDGE odds observation")
    run("git", "pull", "--rebase", "origin", "main")
    run("git", "push", "origin", "HEAD:main")


def main() -> None:
    if os.environ.get("EDGE_REPOSITORY_VISIBILITY") != "public":
        raise RuntimeError("Continuous EDGE observation requires a public repository")
    date = datetime.now(prepare_forward.JST).date().isoformat()
    os.environ["EDGE_SERVICE_DATE"] = date
    run("git", "config", "user.name", "boat-race-edge-bot")
    run("git", "config", "user.email", "actions@users.noreply.github.com")
    started = time.monotonic()
    failures = 0
    with tempfile.TemporaryDirectory(prefix="edge-shadow-watch-") as folder:
        session = Path(folder)
        while time.monotonic() - started < MAX_SECONDS:
            now = datetime.now(prepare_forward.JST)
            if now.date().isoformat() != date or now.hour >= 22:
                break
            try:
                payload, state, state_path = edge_shadow.prepare(session)
                if payload:
                    runtime = ROOT / ".runtime"
                    runtime.mkdir(exist_ok=True)
                    payload_path = runtime / "edge-payload.json"
                    prepare_forward._atomic_json(payload_path, payload)
                    run(sys.executable, "scripts/send_payload.py", str(payload_path))
                    persist_state = dict(state)
                    prepare_forward._atomic_json(state_path, persist_state)
                    persist(state_path)
                    payload_path.unlink(missing_ok=True)
                failures = 0
            except Exception as error:
                failures += 1
                print(json.dumps({"edge_watch_error": type(error).__name__, "failures": failures}), flush=True)
                if failures >= 5:
                    raise
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
