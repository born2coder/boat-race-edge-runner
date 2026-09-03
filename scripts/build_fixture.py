#!/usr/bin/env python3
"""Build a small, auditable BOAT RACE PoC fixture from official downloads.

The official B (program) and K (results) archives are CP932 text inside LZH.
This script intentionally downloads only two dates: one completed day for an
end-to-end replay and the requested current day for forward-only candidates.
It does not crawl HTML pages or bulk-download history.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import lhafile


JST = timezone(timedelta(hours=9))
SOURCE_BASE = "https://www1.mbrace.or.jp/od2"
SELECTION_THRESHOLD = 95
VENUES = {
    "01": "桐生", "02": "戸田", "03": "江戸川", "04": "平和島",
    "05": "多摩川", "06": "浜名湖", "07": "蒲郡", "08": "常滑",
    "09": "津", "10": "三国", "11": "びわこ", "12": "住之江",
    "13": "尼崎", "14": "鳴門", "15": "丸亀", "16": "児島",
    "17": "宮島", "18": "徳山", "19": "下関", "20": "若松",
    "21": "芦屋", "22": "福岡", "23": "唐津", "24": "大村",
}


def nfkc(value: str) -> str:
    return unicodedata.normalize("NFKC", value)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Artifact:
    kind: str
    date: str
    url: str
    fetched_at: str
    content_sha256: str
    byte_length: int
    text: str


def archive_url(kind: str, date: str) -> str:
    dt = datetime.strptime(date, "%Y-%m-%d")
    yyyymm = dt.strftime("%Y%m")
    stem = f"{kind.lower()}{dt.strftime('%y%m%d')}.lzh"
    return f"{SOURCE_BASE}/{kind}/{yyyymm}/{stem}"


def fetch_artifact(kind: str, date: str) -> Artifact:
    url = archive_url(kind, date)
    request = urllib.request.Request(url, headers={"User-Agent": "BoatRaceEdgePoC/0.1 (single-day verification)"})
    with urllib.request.urlopen(request, timeout=30) as response:
        blob = response.read()
    archive_path = Path("/tmp") / f"boat-race-{kind.lower()}-{date}.lzh"
    archive_path.write_bytes(blob)
    archive = lhafile.Lhafile(str(archive_path))
    names = archive.namelist()
    if len(names) != 1:
        raise RuntimeError(f"Unexpected {kind} archive contents: {names}")
    raw_text = archive.read(names[0])
    text = raw_text.decode("cp932", errors="strict")
    return Artifact(
        kind=kind,
        date=date,
        url=url,
        fetched_at=datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        content_sha256=sha256_bytes(blob),
        byte_length=len(blob),
        text=text,
    )


def split_segments(text: str, kind: str) -> list[tuple[str, list[str]]]:
    start = re.compile(rf"^(\d{{2}}){kind}BGN$")
    end = re.compile(rf"^(\d{{2}}){kind}END$")
    segments: list[tuple[str, list[str]]] = []
    code: str | None = None
    lines: list[str] = []
    for line in text.splitlines():
        if match := start.match(line.strip()):
            code = match.group(1)
            lines = []
            continue
        if match := end.match(line.strip()):
            if code != match.group(1):
                raise RuntimeError(f"Mismatched segment terminator: {line}")
            segments.append((code, lines))
            code = None
            lines = []
            continue
        if code is not None:
            lines.append(line)
    return segments


def parse_program(artifact: Artifact) -> list[dict[str, Any]]:
    races: list[dict[str, Any]] = []
    for venue_code, lines in split_segments(artifact.text, "B"):
        current: dict[str, Any] | None = None
        for raw_line in lines:
            line = nfkc(raw_line)
            race_match = re.match(
                r"^\s*(\d{1,2})R\s+(.+?)\s+H\d+m\s+.*?電話投票締切予定(\d{2}):(\d{2})",
                line,
            )
            if race_match:
                race_no = int(race_match.group(1))
                start_local = datetime.fromisoformat(
                    f"{artifact.date}T{race_match.group(3)}:{race_match.group(4)}:00"
                ).replace(tzinfo=JST)
                current = {
                    "race_id": f"BR:{artifact.date.replace('-', '')}:{venue_code}:{race_no:02d}",
                    "race_date": artifact.date,
                    "venue_code": venue_code,
                    "venue": VENUES[venue_code],
                    "race_no": race_no,
                    "race_name": race_match.group(2).strip(),
                    "start_at": start_local.astimezone(timezone.utc).isoformat(),
                    "start_time_jst": start_local.strftime("%H:%M"),
                    "entries": [],
                }
                races.append(current)
                continue
            if (
                current is not None
                and len(raw_line) >= 58
                and re.match(r"^[1-6] \d{4}", raw_line)
            ):
                entry = {
                    "lane_no": int(raw_line[0]),
                    "racer_id": raw_line[2:6],
                    "racer_name": raw_line[6:10].replace("　", "").replace(" ", ""),
                    "age": int(raw_line[10:12]),
                    "branch": raw_line[12:14].strip(),
                    "weight_kg": int(raw_line[14:16]),
                    "class": raw_line[16:18].strip(),
                    "national_win_rate": float(raw_line[19:23]),
                    "national_2rate": float(raw_line[24:29]),
                    "local_win_rate": float(raw_line[30:34]),
                    "local_2rate": float(raw_line[35:40]),
                    "motor_no": int(raw_line[41:43]),
                    "motor_2rate": float(raw_line[44:49]),
                    "equipment_boat_no": int(raw_line[50:52]),
                    "boat_2rate": float(raw_line[53:58]),
                }
                current["entries"].append(entry)
    broken = [race["race_id"] for race in races if len(race["entries"]) != 6]
    if broken:
        raise RuntimeError(f"Program parse failed; races without six entries: {broken[:8]}")
    return races


def parse_results(artifact: Artifact) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    for venue_code, lines in split_segments(artifact.text, "K"):
        current_race: int | None = None
        for raw_line in lines:
            line = nfkc(raw_line)
            payout = re.match(r"^\s*(\d{1,2})R\s+([1-6]-[1-6]-[1-6])\s+(\d+)", line)
            if payout:
                race_no = int(payout.group(1))
                race_id = f"BR:{artifact.date.replace('-', '')}:{venue_code}:{race_no:02d}"
                results.setdefault(race_id, {"finishers": []}).update(
                    {"combination": payout.group(2), "payout_per_100_yen": int(payout.group(3))}
                )
                continue
            header = re.match(r"^\s*(\d{1,2})R\s+.*?H\d+m\s+(.+?)\s+風\s+(.+?)\s+(\d+)m\s+波\s+(\d+)cm", line)
            if header:
                current_race = int(header.group(1))
                race_id = f"BR:{artifact.date.replace('-', '')}:{venue_code}:{current_race:02d}"
                results.setdefault(race_id, {"finishers": []}).update({
                    "weather": header.group(2).strip(),
                    "wind_direction": header.group(3).strip(),
                    "wind_speed_m": int(header.group(4)),
                    "wave_height_cm": int(header.group(5)),
                })
                continue
            finisher = re.match(r"^\s*(\d{2}|F|L0|L1|K0|K1|S0|S1|S2)\s+([1-6])\s+(\d{4})\s+", line)
            if finisher and current_race is not None:
                race_id = f"BR:{artifact.date.replace('-', '')}:{venue_code}:{current_race:02d}"
                code = finisher.group(1)
                results.setdefault(race_id, {"finishers": []})["finishers"].append({
                    "finish_position": int(code) if code.isdigit() else None,
                    "result_code": None if code.isdigit() else code,
                    "lane_no": int(finisher.group(2)),
                    "racer_id": finisher.group(3),
                })
    return results


def score_race(race: dict[str, Any]) -> tuple[int, list[str]]:
    entries = race["entries"]
    inside = entries[0]
    challengers = entries[1:4]
    score = 20
    reasons: list[str] = []
    if inside["national_win_rate"] < 4.8:
        score += 32
        reasons.append("1号艇の全国勝率が4.80未満")
    elif inside["national_win_rate"] < 5.5:
        score += 20
        reasons.append("1号艇の全国勝率が5.50未満")
    elif inside["national_win_rate"] < 6.0:
        score += 10
        reasons.append("1号艇の全国勝率が6.00未満")

    best_challenger = max(challengers, key=lambda row: row["national_win_rate"])
    win_gap = best_challenger["national_win_rate"] - inside["national_win_rate"]
    if win_gap >= 1.0:
        score += 24
        reasons.append("2〜4号艇に全国勝率で1.00以上上回る選手")
    elif win_gap >= 0.4:
        score += 14
        reasons.append("2〜4号艇に全国勝率で上回る選手")

    best_motor = max(challengers, key=lambda row: row["motor_2rate"])
    motor_gap = best_motor["motor_2rate"] - inside["motor_2rate"]
    if motor_gap >= 10:
        score += 18
        reasons.append("2〜4号艇にモーター2連対率で10pt以上の優位")
    elif motor_gap >= 5:
        score += 10
        reasons.append("2〜4号艇にモーター2連対率で5pt以上の優位")

    spread = max(row["national_win_rate"] for row in entries) - min(row["national_win_rate"] for row in entries)
    if spread >= 3:
        score += 6
        reasons.append("レース内の全国勝率差が大きい")
    return min(score, 100), reasons or ["暫定選別条件に該当せず"]


def rank_entries(race: dict[str, Any]) -> list[dict[str, Any]]:
    ranked = []
    for entry in race["entries"]:
        composite = (
            entry["national_win_rate"] * 0.52
            + entry["local_win_rate"] * 0.28
            + entry["motor_2rate"] * 0.012
            + entry["boat_2rate"] * 0.008
        )
        ranked.append({"lane_no": entry["lane_no"], "racer_name": entry["racer_name"], "score": round(composite, 4)})
    ranked.sort(key=lambda row: (-row["score"], row["lane_no"]))
    return [{**row, "rank": index + 1} for index, row in enumerate(ranked)]


def make_prediction(race: dict[str, Any], observed_at: str, *, replay: bool) -> dict[str, Any]:
    selection_score, reasons = score_race(race)
    ranking = rank_entries(race)
    top = [str(row["lane_no"]) for row in ranking[:3]]
    combinations = [f"{top[0]}-{top[1]}-{top[2]}", f"{top[0]}-{top[2]}-{top[1]}", f"{top[1]}-{top[0]}-{top[2]}"]
    stakes = [400, 300, 300]
    identity = {"race_id": race["race_id"], "model": "poc-score-v0.1", "bets": list(zip(combinations, stakes))}
    prediction_id = "pred_" + canonical_hash(identity)[:20]
    published_at = observed_at
    payload = {
        "prediction_id": prediction_id,
        "race_id": race["race_id"],
        "model_version": "poc-score-v0.1",
        "strategy_version": "fixed-3tickets-v0.1",
        "selection_score": selection_score,
        "selection_reasons": reasons,
        "ranking": ranking[:3],
        "tickets": [
            {"bet_type": "trifecta", "combination": combination, "stake_yen": stake}
            for combination, stake in zip(combinations, stakes)
        ],
        "virtual_stake_yen": sum(stakes),
        "published_at": published_at,
        "publication_mode": "historical_replay" if replay else "private_forward_poc",
        "official_performance_eligible": False,
    }
    payload["publication_hash"] = canonical_hash(payload)
    return payload


def settle(prediction: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    winning = result["combination"]
    payout = result["payout_per_100_yen"]
    lines = []
    gross = 0
    for ticket in prediction["tickets"]:
        returned = payout * ticket["stake_yen"] // 100 if ticket["combination"] == winning else 0
        gross += returned
        lines.append({**ticket, "return_yen": returned})
    stake = prediction["virtual_stake_yen"]
    return {
        "status": "settled_replay",
        "result_combination": winning,
        "payout_per_100_yen": payout,
        "original_stake_yen": stake,
        "counted_stake_yen": stake,
        "refund_yen": 0,
        "gross_return_yen": gross,
        "profit_yen": gross - stake,
        "hit": gross > 0,
        "lines": lines,
    }


def build_fixture(completed_date: str, current_date: str) -> dict[str, Any]:
    completed_b = fetch_artifact("B", completed_date)
    completed_k = fetch_artifact("K", completed_date)
    current_b = fetch_artifact("B", current_date)

    completed_races = parse_program(completed_b)
    completed_results = parse_results(completed_k)
    current_races = parse_program(current_b)

    if set(race["race_id"] for race in completed_races) != set(completed_results):
        missing = set(race["race_id"] for race in completed_races) - set(completed_results)
        raise RuntimeError(f"Program/result race key mismatch: {sorted(missing)[:8]}")

    replay_candidates = []
    decisions = []
    replay_recorded_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for race in completed_races:
        score, reasons = score_race(race)
        decision = "recommend" if score >= SELECTION_THRESHOLD else "skip"
        decisions.append({"race_id": race["race_id"], "score": score, "decision": decision, "reasons": reasons})
        if decision == "recommend":
            prediction = make_prediction(race, replay_recorded_at, replay=True)
            prediction["race"] = race
            prediction["result"] = {**completed_results[race["race_id"]], "settlement": settle(prediction, completed_results[race["race_id"]])}
            replay_candidates.append(prediction)

    now = datetime.now(timezone.utc).replace(microsecond=0)
    forward_candidates = []
    for race in current_races:
        score, reasons = score_race(race)
        start_at = datetime.fromisoformat(race["start_at"])
        start_at_jst = start_at.astimezone(JST)
        if (
            score >= SELECTION_THRESHOLD
            and start_at > now + timedelta(hours=2)
            and start_at_jst.hour >= 18
        ):
            prediction = make_prediction(race, now.isoformat(), replay=False)
            prediction["race"] = race
            prediction["result"] = None
            forward_candidates.append(prediction)
    forward_candidates.sort(key=lambda item: (-item["selection_score"], item["race"]["start_at"]))
    forward_candidates = forward_candidates[:3]

    venue_summaries = []
    for venue_code in sorted({race["venue_code"] for race in current_races}):
        venue_races = [race for race in current_races if race["venue_code"] == venue_code]
        target_races = [
            {
                "prediction_id": prediction["prediction_id"],
                "race_id": prediction["race_id"],
                "race_no": prediction["race"]["race_no"],
                "race_name": prediction["race"]["race_name"],
                "start_time_jst": prediction["race"]["start_time_jst"],
            }
            for prediction in forward_candidates
            if prediction["race"]["venue_code"] == venue_code
        ]
        venue_summaries.append({
            "venue_code": venue_code,
            "venue": VENUES[venue_code],
            "race_count": len(venue_races),
            "target_races": target_races,
        })
    venue_summaries.sort(key=lambda item: (-len(item["target_races"]), item["venue_code"]))

    replay_stake = sum(item["result"]["settlement"]["counted_stake_yen"] for item in replay_candidates)
    replay_return = sum(item["result"]["settlement"]["gross_return_yen"] for item in replay_candidates)
    replay_hits = sum(1 for item in replay_candidates if item["result"]["settlement"]["hit"])

    artifacts = [completed_b, completed_k, current_b]
    return {
        "schema_version": "boat-race-poc-fixture/v1",
        "generated_at": now.isoformat(),
        "timezone": "Asia/Tokyo",
        "source_notice": "BOAT RACE公式配布の番組表・競走成績を1開催日単位で検証。公開・商用二次利用の許諾は未確認。",
        "artifacts": [
            {
                "kind": item.kind,
                "date": item.date,
                "url": item.url,
                "fetched_at": item.fetched_at,
                "content_sha256": item.content_sha256,
                "byte_length": item.byte_length,
            }
            for item in artifacts
        ],
        "current_day": {
            "date": current_date,
            "venue_count": len({race["venue_code"] for race in current_races}),
            "analyzed_count": len(current_races),
            "recommended_count": len(forward_candidates),
            "skipped_count": len(current_races) - len(forward_candidates),
            "incomplete_count": 0,
            "coverage_percent": 100,
            "status": "complete",
            "venues": venue_summaries,
            "predictions": forward_candidates,
        },
        "replay_day": {
            "date": completed_date,
            "venue_count": len({race["venue_code"] for race in completed_races}),
            "race_count": len(completed_races),
            "entry_count": sum(len(race["entries"]) for race in completed_races),
            "result_count": len(completed_results),
            "decisions": decisions,
            "predictions": replay_candidates,
            "stats": {
                "published_predictions": len(replay_candidates),
                "settled_predictions": len(replay_candidates),
                "hits": replay_hits,
                "hit_rate": round(replay_hits / len(replay_candidates) * 100, 1) if replay_candidates else None,
                "total_stake_yen": replay_stake,
                "total_return_yen": replay_return,
                "profit_yen": replay_return - replay_stake,
                "return_rate": round(replay_return / replay_stake * 100, 1) if replay_stake else None,
            },
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--completed-date", default="2026-08-30")
    parser.add_argument("--current-date", default="2026-08-31")
    parser.add_argument("--output", default="lib/data/fixture.json")
    args = parser.parse_args()
    fixture = build_fixture(args.completed_date, args.current_date)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output),
        "current_predictions": fixture["current_day"]["recommended_count"],
        "replay_races": fixture["replay_day"]["race_count"],
        "replay_predictions": fixture["replay_day"]["stats"]["published_predictions"],
        "replay_hits": fixture["replay_day"]["stats"]["hits"],
        "replay_return_rate": fixture["replay_day"]["stats"]["return_rate"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
