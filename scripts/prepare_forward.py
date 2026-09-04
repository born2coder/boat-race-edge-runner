#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any


MODEL_FILENAME = "W_morning_badge_v1.tar.gz.enc"
MODEL_SHA256 = "b23c19b418365f4707c0096471aeb33cf39cb37f726d4b14842ede929083582a"
MODEL_VERSION = "W_morning_badge_v1"
STATE_SCHEMA = "boat-race-edge-forward-state/v2"
PAYLOAD_SCHEMA = "boat-race-edge-ingest/v1"
UPSTREAM = "https://github.com/BoatraceCSV/boatracecsv.github.io.git"
JST = timezone(timedelta(hours=9))
MORNING_LOCK_DEADLINE = time(9, 30)
DAILY_CAP = 10
VENUES = {
    1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川", 6: "浜名湖",
    7: "蒲郡", 8: "常滑", 9: "津", 10: "三国", 11: "びわこ", 12: "住之江",
    13: "尼崎", 14: "鳴門", 15: "丸亀", 16: "児島", 17: "宮島", 18: "徳山",
    19: "下関", 20: "若松", 21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村",
}


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_number(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _safe_extract(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            target = (destination / member.name).resolve()
            if root != target and root not in target.parents:
                raise RuntimeError("Model archive contains an unsafe path")
            if member.issym() or member.islnk():
                raise RuntimeError("Model archive contains a link")
        archive.extractall(destination, filter="data")


def _download_model(destination: Path) -> None:
    repository = _required("EDGE_MODEL_REPOSITORY")
    token = _required("EDGE_MODEL_TOKEN")
    url = f"https://api.github.com/repos/{repository}/contents/{MODEL_FILENAME}?ref=main"
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github.raw+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "BoatRaceEdgeForwardRunner/2.0",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def _decrypt_model(encrypted: Path, plaintext: Path) -> None:
    environment = os.environ.copy()
    environment["EDGE_MODEL_KEY"] = _required("EDGE_MODEL_KEY")
    subprocess.run([
        "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000",
        "-in", str(encrypted), "-out", str(plaintext), "-pass", "env:EDGE_MODEL_KEY",
    ], check=True, env=environment)
    if _sha256(plaintext) != MODEL_SHA256:
        raise RuntimeError("Decrypted model bundle hash mismatch")


def _clone_data(destination: Path, date: str) -> Path:
    day = datetime.strptime(date, "%Y-%m-%d")
    subprocess.run([
        "git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", UPSTREAM, str(destination)
    ], check=True)
    paths = [
        f"data/programs/race_cards/{day:%Y}/{day:%m}",
        f"data/programs/title/{day:%Y}/{day:%m}",
        f"data/previews/tkz/{day:%Y}/{day:%m}",
        f"data/previews/stt/{day:%Y}/{day:%m}",
        f"data/previews/sui/{day:%Y}/{day:%m}",
    ]
    subprocess.run(["git", "-C", str(destination), "sparse-checkout", "set", *paths], check=True)
    return destination / "data"


def _day_path(data_root: Path, family: str, date: str) -> Path:
    day = datetime.strptime(date, "%Y-%m-%d")
    return data_root / family / f"{day:%Y}" / f"{day:%m}" / f"{day:%d}.csv"


def _load_cards(data_root: Path, date: str):
    import pandas as pd

    cards = pd.read_csv(_day_path(data_root, "programs/race_cards", date), dtype={"レースコード": str})
    title_path = _day_path(data_root, "programs/title", date)
    titles = pd.read_csv(title_path, dtype={"レースコード": str}) if title_path.exists() else pd.DataFrame()
    cards["レースコード"] = cards["レースコード"].astype(str)
    if not titles.empty:
        titles["レースコード"] = titles["レースコード"].astype(str)
    return cards, titles


def _load_service_day_compatible(model_module, data_root: Path, date: str):
    """Normalize preview timestamps at the frozen model's input boundary.

    The pinned v1 bundle creates timezone-naive NaT columns when previews are
    absent. Keep the model archive unchanged, but give its loader typed missing
    timestamps so morning-only data is valid. Missing times remain missing and
    cannot qualify a race for an exhibition reassessment.
    """
    import pandas as pd

    original_preview = model_module._preview

    def timezone_safe_preview(root, source, day):
        preview = original_preview(root, source, day).copy()
        column = f"{source}_obtained_at"
        values = preview[column] if column in preview else pd.Series(
            pd.NaT, index=preview.index, dtype="datetime64[ns, UTC]"
        )
        preview[column] = pd.to_datetime(values, errors="coerce", utc=True).dt.tz_convert("Asia/Tokyo")
        return preview

    model_module._preview = timezone_safe_preview
    try:
        return model_module.load_service_day(data_root, date)
    finally:
        model_module._preview = original_preview


def _entry(card, frame, lane: int) -> dict[str, Any]:
    get = lambda label, default=0: card.get(f"艇{lane}_{label}", default)
    return {
        "lane_no": lane,
        "racer_id": str(get("登録番号", "")),
        "racer_name": str(get("選手名", "")).replace("　", " ").strip(),
        "age": int(_safe_number(get("年齢"), 0)),
        "branch": str(get("支部", "")).strip(),
        "weight_kg": _safe_number(frame.get(f"b{lane}_weight"), 0),
        "class": str(get("級別", "B2")).strip(),
        "national_win_rate": _safe_number(get("全国勝率")),
        "national_2rate": _safe_number(get("全国2連対率")),
        "local_win_rate": _safe_number(get("当地勝率")),
        "local_2rate": _safe_number(get("当地2連対率")),
        "motor_no": int(_safe_number(get("モーター番号"), 0)),
        "motor_2rate": _safe_number(get("モーター2連対率")),
        "equipment_boat_no": int(_safe_number(get("ボート番号"), 0)),
        "boat_2rate": _safe_number(get("ボート2連対率")),
    }


def _race_record(frame, cards, titles) -> dict[str, Any]:
    import pandas as pd

    raw_id = str(frame["race_id"])
    card = cards.loc[cards["レースコード"].eq(raw_id)].iloc[0]
    title = titles.loc[titles["レースコード"].eq(raw_id)].iloc[0] if not titles.empty and titles["レースコード"].eq(raw_id).any() else None
    deadline = pd.Timestamp(frame["deadline_at"])
    venue = int(frame["venue"])
    site_id = raw_id.zfill(12)
    return {
        "race_id": f"BR:{site_id[:8]}:{site_id[8:10]}:{site_id[10:12]}",
        "race_date": str(pd.Timestamp(frame["race_date"]).date()),
        "venue_code": f"{venue:02d}",
        "venue": VENUES.get(venue, f"場{venue:02d}"),
        "race_no": int(frame["race_number"]),
        "race_name": str(title.get("レース名", "一般")) if title is not None else "一般",
        "start_at": deadline.isoformat(),
        "start_time_jst": deadline.strftime("%H:%M"),
        "entries": [_entry(card, frame, lane) for lane in range(1, 7)],
    }


def _ranking(prediction, race: dict[str, Any]) -> list[dict[str, Any]]:
    scores = {lane: 0.0 for lane in range(1, 7)}
    for rank in range(1, 9):
        lane = int(str(prediction[f"top{rank}_combo"]).split("-")[0])
        scores[lane] += float(prediction[f"top{rank}_score"])
    names = {entry["lane_no"]: entry["racer_name"] for entry in race["entries"]}
    order = sorted(scores, key=lambda lane: (-scores[lane], lane))
    return [
        {"lane_no": lane, "racer_name": names[lane], "score": round(scores[lane], 8), "rank": rank}
        for rank, lane in enumerate(order, 1)
    ]


def _prediction_record(prediction, race: dict[str, Any], published_at: str) -> dict[str, Any]:
    combinations = [str(prediction[f"top{rank}_combo"]) for rank in range(1, 9)]
    identity = {"race_id": race["race_id"], "model": MODEL_VERSION, "combinations": combinations}
    item: dict[str, Any] = {
        "prediction_id": "pred_" + _sha_bytes(_canonical(identity))[:20],
        "race_id": race["race_id"],
        "model_version": MODEL_VERSION,
        "strategy_version": "morning-top3-flat100-v1",
        "selection_score": int(round(float(prediction["morning_score"]) * 100)),
        "selection_reasons": [
            "朝の出走表だけで全レースを比較",
            "朝モデルの上位10レースに選出",
            "展示・オッズ・払戻を使わず買い目を固定",
        ],
        "ranking": _ranking(prediction, race),
        "tickets": [{"bet_type": "trifecta", "combination": combo, "stake_yen": 100} for combo in combinations],
        "virtual_stake_yen": 300,
        "published_at": published_at,
        "publication_mode": "morning_fixed_hit_v1",
        "official_performance_eligible": True,
    }
    item["publication_hash"] = _sha_bytes(_canonical(item))
    return item


def _artifact(data_root: Path, family: str, kind: str, date: str, generated_at: str) -> dict[str, Any] | None:
    path = _day_path(data_root, family, date)
    if not path.exists() or path.stat().st_size == 0:
        return None
    content = path.read_bytes()
    relative = path.relative_to(data_root).as_posix()
    return {
        "kind": kind,
        "date": date,
        "url": f"https://boatracecsv.github.io/data/{relative}",
        "fetched_at": generated_at,
        "content_sha256": _sha_bytes(content),
        "byte_length": len(content),
    }


def _write_outputs(pending: bool, state_file: Path, repository_root: Path) -> None:
    output = os.environ.get("GITHUB_OUTPUT")
    if not output:
        return
    with Path(output).open("a", encoding="utf-8") as handle:
        handle.write(f"pending={'true' if pending else 'false'}\n")
        handle.write(f"state_file={state_file.relative_to(repository_root).as_posix()}\n")


def main() -> None:
    import pandas as pd

    date = os.environ.get("EDGE_SERVICE_DATE") or datetime.now(JST).date().isoformat()
    repository_root = Path(__file__).resolve().parents[1]
    runtime = repository_root / ".runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    payload_path = runtime / "payload.json"
    payload_path.unlink(missing_ok=True)
    state_path = repository_root / "state" / MODEL_VERSION / f"{date}.json"

    with tempfile.TemporaryDirectory(prefix="edge-forward-") as temporary:
        temporary_root = Path(temporary)
        data_root = _clone_data(temporary_root / "boatracecsv", date)
        card_path = _day_path(data_root, "programs/race_cards", date)
        title_path = _day_path(data_root, "programs/title", date)
        if not card_path.exists() or card_path.stat().st_size == 0 or not title_path.exists() or title_path.stat().st_size == 0:
            _write_outputs(False, state_path, repository_root)
            print(json.dumps({"date": date, "pending": False, "reason": "morning_sources_not_ready"}))
            return

        encrypted = temporary_root / MODEL_FILENAME
        plaintext = temporary_root / "W_morning_badge_v1.tar.gz"
        extracted = temporary_root / "model"
        _download_model(encrypted)
        _decrypt_model(encrypted, plaintext)
        _safe_extract(plaintext, extracted)
        sys.path.insert(0, str(extracted))
        from edge_research import hybrid_forward
        from edge_research.hybrid_forward import (
            classify_reassessment,
            load_frozen,
            predict_exhibition,
            predict_morning,
        )

        artifact_dir = extracted / "artifacts" / "frozen_w_morning_badge_v1"
        manifest, models, morning_reference, exhibition_reference = load_frozen(artifact_dir)
        if date < manifest["genuine_forward_not_before"]:
            _write_outputs(False, state_path, repository_root)
            print(json.dumps({
                "date": date,
                "pending": False,
                "reason": "before_genuine_forward_start",
                "genuine_forward_not_before": manifest["genuine_forward_not_before"],
            }))
            return
        now = pd.Timestamp(datetime.now(timezone.utc))
        now_jst = now.tz_convert("Asia/Tokyo")
        schedule = _load_service_day_compatible(hybrid_forward, data_root, date)
        cards, titles = _load_cards(data_root, date)

        if state_path.exists():
            state = json.loads(state_path.read_text(encoding="utf-8"))
            if state.get("date") != date or state.get("model_version") != MODEL_VERSION:
                raise RuntimeError("Forward state date/model mismatch")
        else:
            if now_jst.time() > MORNING_LOCK_DEADLINE:
                _write_outputs(False, state_path, repository_root)
                print(json.dumps({"date": date, "pending": False, "reason": "morning_lock_deadline_passed"}))
                return
            morning = predict_morning(schedule, models["morning"])
            selected = morning.sort_values(["morning_score", "race_id"], ascending=[False, True]).head(DAILY_CAP)
            if len(selected) < DAILY_CAP:
                _write_outputs(False, state_path, repository_root)
                print(json.dumps({"date": date, "pending": False, "reason": "fewer_than_ten_races"}))
                return
            selected_items = []
            for row in selected.itertuples(index=False):
                series = pd.Series(row._asdict())
                source_frame = schedule.loc[schedule["race_id"].eq(str(row.race_id))].iloc[0]
                race = _race_record(source_frame, cards, titles)
                prediction = _prediction_record(series, race, now.isoformat())
                selected_items.append({
                    "race_id_raw": str(row.race_id),
                    "race": race,
                    "morning": {
                        "score": float(row.morning_score),
                        **{f"top{rank}_combo": str(getattr(row, f"top{rank}_combo")) for rank in range(1, 9)},
                    },
                    "prediction": prediction,
                    "reassessment": None,
                    "reassessment_published_at": None,
                })
            state = {
                "schema_version": STATE_SCHEMA,
                "date": date,
                "model_version": MODEL_VERSION,
                "selected": selected_items,
                "published_count": 0,
                "pending_reassessment_ids": [],
                "morning_locked_at": now.isoformat(),
            }

        exhibition = predict_exhibition(schedule, models["exhibition"])
        exhibition_by_id = {str(row.race_id): pd.Series(row._asdict()) for row in exhibition.itertuples(index=False)}
        pending_reassessment_ids = set(state.get("pending_reassessment_ids", []))
        for item in state["selected"]:
            if item.get("reassessment") is not None:
                continue
            raw_id = item["race_id_raw"]
            if raw_id not in exhibition_by_id:
                continue
            full = exhibition_by_id[raw_id]
            cutoff = pd.Timestamp(full["safe_cutoff_at"]).tz_convert("UTC")
            ready = pd.Timestamp(full["source_ready_at"]).tz_convert("UTC")
            if not bool(full["source_safe"]) or ready > now or now > cutoff:
                continue
            morning_series = pd.Series({
                "morning_score": item["morning"]["score"],
                **{f"top{rank}_combo": item["morning"][f"top{rank}_combo"] for rank in range(1, 9)},
            })
            signal = classify_reassessment(morning_series, full, morning_reference, exhibition_reference)
            reassessment = {
                "prediction_id": item["prediction"]["prediction_id"],
                "race_id": item["prediction"]["race_id"],
                "status": signal["status"],
                "top3_overlap": signal["top3_overlap"],
                "morning_percentile": round(signal["morning_percentile"], 8),
                "exhibition_percentile": round(signal["exhibition_percentile"], 8),
                "percentile_uplift": round(signal["percentile_uplift"], 8),
                "rule_version": signal["rule_version"],
                "observed_at": ready.isoformat(),
            }
            reassessment["reassessment_hash"] = _sha_bytes(_canonical(reassessment))
            item["reassessment"] = reassessment
            pending_reassessment_ids.add(item["prediction"]["prediction_id"])

        state["pending_reassessment_ids"] = sorted(pending_reassessment_ids)
        state["updated_at"] = now.isoformat()
        _atomic_json(state_path, state)

        published_count = min(int(state.get("published_count", 0)), len(state["selected"]))
        pending_items = state["selected"][published_count:]
        pending_ids = set(state.get("pending_reassessment_ids", []))
        pending_reassessments = [
            item["reassessment"] for item in state["selected"]
            if item.get("reassessment") and item["prediction"]["prediction_id"] in pending_ids
        ]
        generated_at = now.isoformat()
        artifacts = [
            _artifact(data_root, "programs/race_cards", "race_cards", date, generated_at),
            _artifact(data_root, "programs/title", "title", date, generated_at),
            _artifact(data_root, "previews/tkz", "tkz", date, generated_at),
            _artifact(data_root, "previews/stt", "stt", date, generated_at),
            _artifact(data_root, "previews/sui", "sui", date, generated_at),
        ]
        if pending_items or pending_reassessments:
            payload = {
                "schema_version": PAYLOAD_SCHEMA,
                "generated_at": generated_at,
                "service_date": date,
                "summary": {
                    "scheduled_races": int(len(schedule)),
                    "predicted_races": int(len(schedule)),
                    "incomplete_races": 0,
                },
                "artifacts": [item for item in artifacts if item is not None],
                "races": [item["race"] for item in pending_items],
                "decisions": [{
                    "race_id": item["prediction"]["race_id"],
                    "model_version": MODEL_VERSION,
                    "score": item["prediction"]["selection_score"],
                    "decision": "recommend",
                    "reasons": item["prediction"]["selection_reasons"],
                } for item in pending_items],
                "predictions": [item["prediction"] for item in pending_items],
                "reassessments": pending_reassessments,
                "results": [],
            }
            _atomic_json(payload_path, payload)

        pending = bool(pending_items or pending_reassessments)
        _write_outputs(pending, state_path, repository_root)
        print(json.dumps({
            "date": date,
            "selected": len(state["selected"]),
            "new_predictions": len(pending_items),
            "new_reassessments": len(pending_reassessments),
            "pending": pending,
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
