#!/usr/bin/env python3
"""Restore missing publication receipts from immutable main-branch commit times."""
from __future__ import annotations

import argparse
import bisect
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def commit_times(path: str, ref: str) -> list[tuple[float, str]]:
    output = subprocess.check_output(
        ["git", "log", ref, "--reverse", "--format=%cI", "--", path], text=True
    )
    return [(datetime.fromisoformat(value).timestamp(), value) for value in output.splitlines()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("date")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--ref", default="origin/main")
    parser.add_argument("--maximum-gap-seconds", type=float, default=120)
    args = parser.parse_args()

    relative = f"state/edge_v2/days/{args.date}.json"
    day = json.loads(args.input.read_text())
    commits = commit_times(relative, args.ref)
    timestamps = [item[0] for item in commits]
    recovered = 0
    unresolved: list[str] = []
    maximum_gap = 0.0

    for race in day["races"].values():
        close = datetime.fromisoformat(race["start_at"]).timestamp()
        receipts = race.setdefault("receipts", {})
        for snapshot in race.get("snapshots", {}).values():
            snapshot_id = snapshot["snapshot_id"]
            if snapshot_id in receipts:
                continue
            observed = datetime.fromisoformat(snapshot["observed_at"]).timestamp()
            index = bisect.bisect_left(timestamps, observed)
            if index >= len(commits):
                unresolved.append(snapshot_id)
                continue
            committed, committed_iso = commits[index]
            gap = committed - observed
            if committed >= close or gap < 0 or gap > args.maximum_gap_seconds:
                unresolved.append(snapshot_id)
                continue
            receipts[snapshot_id] = committed_iso
            recovered += 1
            maximum_gap = max(maximum_gap, gap)

    if unresolved:
        raise SystemExit(f"Refusing partial recovery: {len(unresolved)} snapshots lack timely commit proof")
    day["receipt_recovery"] = {
        "method": "first-main-commit-after-observation",
        "source_ref": args.ref,
        "recovered_at": datetime.now(timezone.utc).isoformat(),
        "recovered_count": recovered,
        "maximum_commit_gap_seconds": maximum_gap,
    }
    args.output.write_text(json.dumps(day, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"recovered": recovered, "maximum_commit_gap_seconds": maximum_gap}))


if __name__ == "__main__":
    main()
