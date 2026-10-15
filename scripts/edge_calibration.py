"""Versioned, out-of-time probability/closing-odds calibration. No model mutation.

Only acknowledged prospective full-120 snapshots are admitted. Each race/phase
counts once; refunded races, incomplete vectors and unknown results are excluded.
All reports and decisions are shadow-only, never entries in the purchase ledger.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

VERSION = "edge-calibration-v1"
COMBOS = {"-".join(x) for x in itertools.permutations("123456", 3)}
PHASES = ("t20", "t15", "t10", "t5")
ODDS_BOUNDS = (10, 30, 100, 300, math.inf)
TEMPERATURES = (0.6, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0)
MIN_TRAIN_DAYS = 7
MIN_TEST_DAYS = 3
MIN_RACES = 100
LOOKBACK_DAYS = 60


def stamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timezone is required")
    return parsed


def finite(value, low=0, high=math.inf):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and low < value <= high


def distribution(values):
    return (isinstance(values, list) and len(values) == 120
            and all(isinstance(p, (int, float)) and not isinstance(p, bool) and math.isfinite(p) and 0 <= p <= 1 for p in values)
            and abs(sum(values) - 1) <= 0.001)


def scaled(probabilities, temperature):
    # A single positive temperature preserves ordering and sums to one.
    values = [max(p, 1e-15) ** (1 / temperature) for p in probabilities]
    total = sum(values)
    return [p / total for p in values]


def odds_band(odds):
    return next(i for i, upper in enumerate(ODDS_BOUNDS) if odds < upper)


def examples(days, as_of, model_sha):
    """As-of receipt/result checks prevent later settlements leaking backwards."""
    cutoff = stamp(as_of + "T00:00:00+09:00")
    earliest = (date.fromisoformat(as_of) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    rows, rejected, seen = [], Counter(), set()
    for day in sorted(days, key=lambda d: d.get("date", "")):
        if not earliest <= day.get("date", "") < as_of:
            continue
        sent = set(day.get("forward_observations_sent", []))
        ignored = set(day.get("forward_observations_ignored", []))
        for race in day.get("races", {}).values():
            result = race.get("result") or {}
            winner = result.get("combination")
            if result.get("cancelled") or result.get("refunded_lanes") or winner not in COMBOS:
                rejected["missing_or_nonstandard_result"] += 1
                continue
            try:
                if stamp(result["evidence"]["obtained_at"]) >= cutoff:
                    rejected["result_not_known_as_of"] += 1
                    continue
            except (KeyError, TypeError, ValueError):
                rejected["result_time_unknown"] += 1
                continue
            final = race.get("final") or {}
            closing = final.get("odds") or {}
            try:
                final_ok = (final.get("validation") == "official-result-payout-match"
                            and final.get("race_identity_verified") == race["race_id"]
                            and set(closing) == COMBOS and all(finite(v, 0, 100000) for v in closing.values())
                            and stamp(race["start_at"]) < stamp(final["observed_at"]) < cutoff
                            and abs(closing[winner] * 100 - result["payout_per_100_yen"]) <= .01)
            except (KeyError, TypeError, ValueError):
                final_ok = False
            for phase in PHASES:
                snapshot = race.get("snapshots", {}).get(phase)
                if not snapshot:
                    continue
                key = (race["race_id"], phase)
                try:
                    combos = snapshot["combinations"]
                    close = stamp(snapshot.get("close_at") or race["start_at"])
                    observed = stamp(snapshot["observed_at"])
                    receipt = stamp(race["receipts"][snapshot["snapshot_id"]])
                    probabilities, odds = snapshot.get("exhibition"), snapshot["odds"]
                    valid = (snapshot["snapshot_id"] in sent - ignored and key not in seen
                             and snapshot.get("model_bundle_sha256") == model_sha
                             and len(combos) == 120 and set(combos) == COMBOS
                             and distribution(probabilities) and len(odds) == 120
                             and all(finite(o, 0, 100000) for o in odds)
                             and observed <= receipt < close < cutoff
                             and stamp(snapshot["computed_at"]) <= receipt
                             and stamp(snapshot["exhibition_source_ready_at"]) <= receipt)
                except (KeyError, TypeError, ValueError):
                    valid = False
                if not valid:
                    rejected["invalid_or_unacknowledged_snapshot"] += 1
                    continue
                seen.add(key)
                rows.append({"date": day["date"], "race_id": race["race_id"], "phase": phase,
                             "p": probabilities, "odds": odds, "winner": combos.index(winner),
                             "payout": result["payout_per_100_yen"],
                             "final": [closing[c] for c in combos] if final_ok else None})
    return rows, dict(rejected)


def probability_metrics(rows, temperature):
    if not rows:
        return None
    loss = brier = 0.0
    buckets = defaultdict(lambda: [0, 0., 0])
    for row in rows:
        p = scaled(row["p"], temperature)
        loss -= math.log(max(p[row["winner"]], 1e-15))
        brier += sum((v - int(i == row["winner"])) ** 2 for i, v in enumerate(p))
        for i, v in enumerate(p):
            band = next((b for b in (.005, .01, .02, .05, .1, .2, 1.01) if v < b))
            bucket = buckets[band]
            bucket[0] += 1
            bucket[1] += v
            bucket[2] += int(i == row["winner"])
    return {"races": len(rows), "logLoss": loss / len(rows), "brier": brier / len(rows),
            "reliability": [{"upper": upper, "tickets": n, "predicted": p / n, "actual": hit / n}
                            for upper, (n, p, hit) in sorted(buckets.items())]}


def fit_odds(rows):
    buckets = defaultdict(list)
    races = defaultdict(set)
    for row in rows:
        if row["final"] is None:
            continue
        for opening, closing in zip(row["odds"], row["final"]):
            band = odds_band(opening)
            buckets[band].append(closing / opening)
            races[band].add(row["race_id"])
    result = {}
    for band, ratios in buckets.items():
        ratios.sort()
        result[str(band)] = {"meanRatio": sum(ratios) / len(ratios),
                            "lowerRatio": ratios[int((len(ratios) - 1) * .25)],
                            "races": len(races[band]), "tickets": len(ratios)}
    return result


def odds_metrics(rows, cells):
    raw_error = adjusted_error = 0.
    n = below = 0
    races = set()
    for row in rows:
        if row["final"] is None:
            continue
        for opening, closing in zip(row["odds"], row["final"]):
            cell = cells.get(str(odds_band(opening)))
            if not cell or cell["races"] < MIN_RACES:
                continue
            raw_error += abs(math.log(opening / closing))
            adjusted_error += abs(math.log(opening * cell["meanRatio"] / closing))
            below += closing < opening * cell["lowerRatio"]
            races.add(row["race_id"])
            n += 1
    return {"races": len(races), "tickets": n, "rawLogError": raw_error / n if n else None,
            "adjustedLogError": adjusted_error / n if n else None,
            "belowLowerRate": below / n if n else None}


def policy_metrics(rows, temperature, cells):
    """Fixed 120% threshold, one phase/race; no post-hoc threshold search."""
    variants = {k: {"tickets": 0, "hits": 0, "stake": 0, "payout": 0} for k in ("baseline", "adjusted")}
    for row in rows:
        adjusted = scaled(row["p"], temperature)
        for i, opening in enumerate(row["odds"]):
            cell = cells.get(str(odds_band(opening)))
            # Match baseline to exactly the supported adjusted cohort.
            if not cell or cell["races"] < MIN_RACES or row["final"] is None:
                continue
            for name, ev in (("baseline", row["p"][i] * .8 * opening),
                             ("adjusted", adjusted[i] * opening * cell["lowerRatio"])):
                if ev >= 1.2:
                    target = variants[name]
                    target["tickets"] += 1
                    target["stake"] += 100
                    if i == row["winner"]:
                        target["hits"] += 1
                        target["payout"] += row["payout"]
    for value in variants.values():
        value["roi"] = value["payout"] / value["stake"] if value["stake"] else None
    return variants


def build_report(days, as_of, model_sha):
    rows, rejected = examples(days, as_of, model_sha)
    dates = sorted({r["date"] for r in rows})
    test_dates = dates[-MIN_TEST_DAYS:]
    train_dates = dates[:-MIN_TEST_DAYS]
    report = {"version": VERSION, "asOf": as_of, "modelSha": model_sha,
              "mode": "shadow", "trainDates": train_dates, "testDates": test_dates,
              "minTrainDays": MIN_TRAIN_DAYS, "minTestDays": MIN_TEST_DAYS,
              "minRaces": MIN_RACES, "lookbackDays": LOOKBACK_DAYS,
              "rejected": rejected, "phases": {}}
    for phase in PHASES:
        phase_rows = [r for r in rows if r["phase"] == phase]
        train = [r for r in phase_rows if r["date"] in train_dates]
        test = [r for r in phase_rows if r["date"] in test_dates]
        enough = (len({r["date"] for r in train}) >= MIN_TRAIN_DAYS
                  and len({r["date"] for r in test}) >= MIN_TEST_DAYS
                  and len(train) >= MIN_RACES and len(test) >= MIN_RACES)
        temperature = min(TEMPERATURES, key=lambda t: sum(-math.log(max(scaled(r["p"], t)[r["winner"]], 1e-15)) for r in train)) if train else 1.0
        raw, corrected = probability_metrics(test, 1), probability_metrics(test, temperature)
        cells = fit_odds(train)
        odds = odds_metrics(test, cells)
        probability_pass = bool(enough and raw and corrected and
                                corrected["logLoss"] < raw["logLoss"] and corrected["brier"] <= raw["brier"])
        odds_pass = bool(enough and odds["tickets"] and odds["races"] >= MIN_RACES
                         and len({r["date"] for r in train if r["final"] is not None}) >= MIN_TRAIN_DAYS
                         and len({r["date"] for r in test if r["final"] is not None}) >= MIN_TEST_DAYS
                         and odds["adjustedLogError"] < odds["rawLogError"]
                         and odds["belowLowerRate"] <= .35)
        report["phases"][phase] = {"trainRaces": len(train), "testRaces": len(test),
            "finalGridTrainRaces": sum(r["final"] is not None for r in train),
            "finalGridTestRaces": sum(r["final"] is not None for r in test),
            "temperature": temperature, "oddsCells": cells,
            "rawProbability": raw, "adjustedProbability": corrected, "oddsValidation": odds,
            "probabilityPass": probability_pass, "oddsPass": odds_pass,
            "status": "review_ready" if probability_pass and odds_pass else "collecting" if not enough else "validation_failed",
            "policyComparison": policy_metrics(test, temperature, cells)}
    digest = hashlib.sha256(json.dumps(report, sort_keys=True, allow_nan=False).encode()).hexdigest()
    report["artifactId"] = VERSION + ":" + digest[:20]
    return report


def shadow_snapshot(snapshot, report):
    """No fallback to optimistic raw EV when a closing-odds cell is unsupported."""
    phase = report.get("phases", {}).get(snapshot.get("phase"))
    try:
        observed_date = (stamp(snapshot["observed_at"]) + timedelta(hours=9)).date().isoformat()
        if (report["asOf"] != observed_date or snapshot.get("model_bundle_sha256") != report["modelSha"]
                or not phase or not distribution(snapshot.get("exhibition"))
                or len(snapshot.get("odds", [])) != 120 or len(snapshot.get("combinations", [])) != 120
                or set(snapshot["combinations"]) != COMBOS
                or not all(finite(v, 0, 100000) for v in snapshot["odds"])):
            return None
    except (KeyError, TypeError, ValueError):
        return None
    p = scaled(snapshot["exhibition"], phase["temperature"])
    mean, lower, ev = [], [], []
    for probability, opening in zip(p, snapshot["odds"]):
        cell = phase["oddsCells"].get(str(odds_band(opening)))
        valid = cell and cell["races"] >= MIN_RACES
        mean.append(opening * cell["meanRatio"] if valid else None)
        lower.append(opening * cell["lowerRatio"] if valid else None)
        ev.append(probability * lower[-1] if valid else None)
    return {"artifactId": report["artifactId"], "mode": "shadow", "status": phase["status"],
            "calibratedProbability": p, "estimatedFinalOdds": mean, "lowerFinalOdds": lower,
            "adjustedEv": ev, "purchaseEnabled": False}


def daily_report(state_root: Path, as_of: str, model_sha: str):
    """One local-only fit per JST day. Archived artifacts are never overwritten."""
    target = state_root / "calibration" / (as_of + ".json")
    if target.exists():
        report = json.loads(target.read_text())
        if report.get("modelSha") != model_sha or report.get("version") != VERSION:
            raise ValueError("Daily calibration model/version mismatch")
        return report
    earliest = (date.fromisoformat(as_of) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    days = [json.loads(path.read_text()) for path in sorted((state_root / "days").glob("*.json"))
            if earliest <= path.stem < as_of]
    report = build_report(days, as_of, model_sha)
    target.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(report, ensure_ascii=False, allow_nan=False) + "\n"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(text)
    temporary.replace(target)
    latest = target.parent / "latest.json"
    temporary = latest.with_suffix(".tmp")
    temporary.write_text(text)
    temporary.replace(latest)
    return report
