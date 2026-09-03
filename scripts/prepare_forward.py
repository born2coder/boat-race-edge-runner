#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


MODEL_FILENAME = "W_dynamic10_v1.tar.gz.enc"
MODEL_SHA256 = "875f2fc26a462530dc332d58c9afa26d9559a101e048d042461d38ca9c58c6f6"
MODEL_VERSION = "W_dynamic10_v1"
UPSTREAM = "https://github.com/BoatraceCSV/boatracecsv.github.io.git"
JST = timezone(timedelta(hours=9))


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
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
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github.raw+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "BoatRaceEdgeForwardRunner/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def _decrypt_model(encrypted: Path, plaintext: Path) -> None:
    environment = os.environ.copy()
    environment["EDGE_MODEL_KEY"] = _required("EDGE_MODEL_KEY")
    subprocess.run(
        [
            "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000",
            "-in", str(encrypted), "-out", str(plaintext), "-pass", "env:EDGE_MODEL_KEY",
        ],
        check=True,
        env=environment,
    )
    if _sha256(plaintext) != MODEL_SHA256:
        raise RuntimeError("Decrypted model bundle hash mismatch")


def _clone_data(destination: Path, date: str) -> Path:
    day = datetime.strptime(date, "%Y-%m-%d")
    subprocess.run(
        ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", UPSTREAM, str(destination)],
        check=True,
    )
    paths = [
        f"data/programs/race_cards/{day:%Y}/{day:%m}",
        f"data/programs/title/{day:%Y}/{day:%m}",
        f"data/previews/tkz/{day:%Y}/{day:%m}",
        f"data/previews/stt/{day:%Y}/{day:%m}",
        f"data/previews/sui/{day:%Y}/{day:%m}",
    ]
    subprocess.run(["git", "-C", str(destination), "sparse-checkout", "set", *paths], check=True)
    return destination / "data"


def _write_outputs(pending: bool, state_file: Path, repository_root: Path) -> None:
    output = os.environ.get("GITHUB_OUTPUT")
    if not output:
        return
    relative = state_file.relative_to(repository_root).as_posix()
    with Path(output).open("a", encoding="utf-8") as handle:
        handle.write(f"pending={'true' if pending else 'false'}\n")
        handle.write(f"state_file={relative}\n")


def main() -> None:
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
        day = datetime.strptime(date, "%Y-%m-%d")
        card_path = data_root / "programs" / "race_cards" / f"{day:%Y}" / f"{day:%m}" / f"{day:%d}.csv"
        if not card_path.exists() or card_path.stat().st_size == 0:
            _write_outputs(False, state_path, repository_root)
            print(json.dumps({"date": date, "pending": False, "reason": "race_cards_not_ready"}))
            return

        encrypted = temporary_root / MODEL_FILENAME
        plaintext = temporary_root / "W_dynamic10_v1.tar.gz"
        extracted = temporary_root / "model"
        _download_model(encrypted)
        _decrypt_model(encrypted, plaintext)
        _safe_extract(plaintext, extracted)
        sys.path.insert(0, str(extracted))

        import numpy as np
        import pandas as pd
        from edge_research.frozen_forward import DAILY_CAP, _load_frozen, _predict_all, load_prerace_day
        from edge_research.site_forward import _artifact, _canonical, _load_cards, _prediction_record, _race_record, _sha_bytes

        artifact_dir = extracted / "artifacts" / "frozen_w_dynamic10_v1"
        manifest, models, history = _load_frozen(artifact_dir)
        if date < manifest["genuine_forward_not_before"]:
            raise RuntimeError("Requested date predates the registered forward start")

        schedule = load_prerace_day(data_root, date)
        predictions = _predict_all(schedule, models)
        events = schedule[["race_id", "deadline_at", "safe_cutoff_at"]].merge(
            predictions, on="race_id", how="left", suffixes=("_schedule", ""), validate="one_to_one"
        )
        events = events.sort_values(["deadline_at_schedule", "race_id"]).reset_index(drop=True)
        events["remaining_scheduled"] = len(events) - np.arange(len(events))
        now = pd.Timestamp(datetime.now(timezone.utc))

        if state_path.exists():
            state = json.loads(state_path.read_text(encoding="utf-8"))
            if state.get("date") != date or state.get("model_version") != MODEL_VERSION:
                raise RuntimeError("Forward state date/model mismatch")
        else:
            state = {
                "schema_version": "boat-race-edge-forward-state/v1",
                "date": date,
                "model_version": MODEL_VERSION,
                "selected": [],
                "published_count": 0,
            }

        selected_ids = {item["race_id_raw"] for item in state["selected"]}
        cards, titles = _load_cards(data_root, date)
        original_count = len(state["selected"])
        for row in events.itertuples(index=False):
            if len(state["selected"]) >= DAILY_CAP:
                break
            raw_id = str(row.race_id)
            if raw_id in selected_ids or pd.isna(getattr(row, "m_score", np.nan)):
                continue
            if not bool(getattr(row, "source_safe", False)):
                continue
            ready = pd.Timestamp(getattr(row, "source_ready_at")).tz_convert("UTC")
            cutoff = pd.Timestamp(getattr(row, "safe_cutoff_at_schedule")).tz_convert("UTC")
            if ready > now or now > cutoff:
                continue
            slots = DAILY_CAP - len(state["selected"])
            remaining = int(getattr(row, "remaining_scheduled"))
            quantile = float(np.clip(1.0 - slots / max(remaining, 1), 0.0, 1.0))
            threshold = float(np.quantile(history, quantile))
            if float(getattr(row, "m_score")) < threshold:
                continue
            series = pd.Series(row._asdict())
            source_frame = schedule.loc[schedule["race_id"].eq(raw_id)].iloc[0]
            race = _race_record(source_frame, cards, titles)
            prediction = _prediction_record(series, race, threshold, quantile, now.isoformat())
            # Keep the model's full Top8 ranking for evaluation. The public
            # product still buys and displays only the first three tickets.
            prediction["tickets"] = prediction["tickets"][:8]
            prediction["virtual_stake_yen"] = 300
            prediction.pop("publication_hash", None)
            prediction["publication_hash"] = _sha_bytes(_canonical(prediction))
            state["selected"].append({"race_id_raw": raw_id, "race": race, "prediction": prediction})
            selected_ids.add(raw_id)

        state["updated_at"] = now.isoformat()
        _atomic_json(state_path, state)
        published_count = min(int(state.get("published_count", 0)), len(state["selected"]))
        pending_items = state["selected"][published_count:]
        generated_at = now.isoformat()
        artifacts = [
            _artifact(data_root, "programs/race_cards", "race_cards", date, generated_at),
            _artifact(data_root, "programs/title", "title", date, generated_at),
            _artifact(data_root, "previews/tkz", "tkz", date, generated_at),
            _artifact(data_root, "previews/stt", "stt", date, generated_at),
            _artifact(data_root, "previews/sui", "sui", date, generated_at),
        ]
        if pending_items:
            payload = {
                "schema_version": "boat-race-edge-ingest/v1",
                "generated_at": generated_at,
                "service_date": date,
                "summary": {
                    "scheduled_races": int(len(schedule)),
                    "predicted_races": int(len(predictions)),
                    "incomplete_races": int((~schedule["all_sources_present"]).sum()),
                },
                "artifacts": [item for item in artifacts if item is not None],
                "races": [item["race"] for item in pending_items],
                "decisions": [
                    {
                        "race_id": item["prediction"]["race_id"],
                        "model_version": MODEL_VERSION,
                        "score": item["prediction"]["selection_score"],
                        "decision": "recommend",
                        "reasons": item["prediction"]["selection_reasons"],
                    }
                    for item in pending_items
                ],
                "predictions": [item["prediction"] for item in pending_items],
                "results": [],
            }
            _atomic_json(payload_path, payload)

        pending = bool(pending_items)
        _write_outputs(pending, state_path, repository_root)
        print(json.dumps({
            "date": date,
            "selected": len(state["selected"]),
            "new_selected": len(state["selected"]) - original_count,
            "pending": pending,
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
