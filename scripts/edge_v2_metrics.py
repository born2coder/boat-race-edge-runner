"""Pre-registered, equal-stake comparisons. No threshold tuning on live results."""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime

VERSION = "edge-full120-v2"
THRESHOLDS = (150, 175, 200, 300)
PHASES = ("t20", "t15", "t10")
MODEL_KINDS = ("morning", "exhibition")


def iso(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def snapshot_hash(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def public_eligible(race, snapshot):
    receipt = race.get("receipts", {}).get(snapshot["snapshot_id"])
    # A server's positive receipt is an upper bound on first public availability.
    return bool(receipt and iso(snapshot["observed_at"]) <= iso(receipt) < iso(race["start_at"]))


def picks(snapshot, model, threshold=150, scope="all120"):
    probabilities = snapshot.get(model)
    if probabilities is None:
        return []
    order = sorted(range(120), key=lambda i: (-probabilities[i], snapshot["combinations"][i]))
    ranks = {i: rank + 1 for rank, i in enumerate(order)}
    output = []
    for i in order:
        if scope == "top8" and ranks[i] > 8:
            continue
        if scope == "rank9plus" and ranks[i] <= 8:
            continue
        p, odds = probabilities[i], snapshot["odds"][i]
        ev = p * odds * 100
        if ev + 1e-9 >= threshold:
            output.append({"combination": snapshot["combinations"][i], "probability": p,
                           "odds": odds, "expected_value_percent": ev, "rank": ranks[i]})
    return output


def summarize(races, phase, model, threshold, scope="all120", paired=False):
    out = {"phase": phase, "model": model, "threshold": threshold, "scope": scope, "paired": paired,
           "observed_races": 0, "public_races": 0, "paired_races": 0, "selected_races": 0,
           "points": 0, "settled_points": 0, "pending_points": 0, "refunded_points": 0,
           "hits": 0, "stake_yen": 0, "payout_yen": 0, "expected_hits": 0.0, "expected_payout_yen": 0.0,
           "scored_races": 0, "log_loss_sum": 0.0, "brier_sum": 0.0}
    for race in races:
        snapshot = race.get("snapshots", {}).get(phase)
        if not snapshot or snapshot.get(model) is None:
            continue
        out["observed_races"] += 1
        if not public_eligible(race, snapshot):
            continue
        out["public_races"] += 1
        has_pair = snapshot.get("morning") is not None and snapshot.get("exhibition") is not None
        if has_pair:
            out["paired_races"] += 1
        if paired and not has_pair:
            continue
        selected = picks(snapshot, model, threshold, scope)
        if selected:
            out["selected_races"] += 1
        out["points"] += len(selected)
        result = race.get("result")
        if not result:
            out["pending_points"] += len(selected)
            continue
        refunds = set(str(x) for x in result.get("refunded_lanes", []))
        if not refunds and not result.get("cancelled") and result["combination"] in snapshot["combinations"]:
            winner = snapshot["combinations"].index(result["combination"])
            probabilities = snapshot[model]
            out["scored_races"] += 1
            out["log_loss_sum"] -= math.log(max(probabilities[winner], 1e-15))
            out["brier_sum"] += sum((p - int(i == winner)) ** 2 for i, p in enumerate(probabilities))
        for pick in selected:
            if refunds.intersection(pick["combination"].split("-")) or result.get("cancelled"):
                out["refunded_points"] += 1
                continue
            out["settled_points"] += 1
            out["stake_yen"] += 100
            out["expected_hits"] += pick["probability"]
            out["expected_payout_yen"] += pick["expected_value_percent"]
            if pick["combination"] == result["combination"]:
                out["hits"] += 1
                out["payout_yen"] += result["payout_per_100_yen"]
    out["return_rate"] = out["payout_yen"] / out["stake_yen"] * 100 if out["stake_yen"] else None
    out["mean_expected_value"] = out["expected_payout_yen"] / out["settled_points"] if out["settled_points"] else None
    return out


def comparison(races):
    return [summarize(races, phase, model, threshold, scope, paired)
            for paired in (False, True) for phase in PHASES for model in MODEL_KINDS
            for scope in ("all120", "top8", "rank9plus") for threshold in THRESHOLDS]


def aggregate_days(days):
    keys = ("phase", "model", "threshold", "scope", "paired")
    sums = {}
    for day in days:
        for row in day.get("comparison", []):
            key = tuple(row[k] for k in keys)
            target = sums.setdefault(key, {k: row[k] for k in keys})
            for field, value in row.items():
                if field not in keys and field not in ("return_rate", "mean_expected_value"):
                    target[field] = target.get(field, 0) + value
    for row in sums.values():
        row["return_rate"] = row["payout_yen"] / row["stake_yen"] * 100 if row["stake_yen"] else None
        row["mean_expected_value"] = row["expected_payout_yen"] / row["settled_points"] if row["settled_points"] else None
    return list(sums.values())
