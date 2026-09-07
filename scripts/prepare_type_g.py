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
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import prepare_forward

ROOT = Path(__file__).resolve().parents[1]
TYPE_G_VERSION = "HIT_type_G_v1"
TYPE_G_ARTIFACT = "hit-type-g-v1"
TYPE_G_STATE_SCHEMA = "boat-race-edge-type-g-state/v1"


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_type_g_artifact(destination: Path) -> tuple[Path, dict[str, Any]]:
    local_artifact = os.environ.get("TYPE_G_ARTIFACT_PATH")
    if local_artifact:
        artifact_dir = Path(local_artifact).resolve()
        encrypted = artifact_dir / f"{TYPE_G_VERSION}.tar.gz.enc"
        manifest_path = artifact_dir / "manifest.json"
        if not encrypted.is_file() or not manifest_path.is_file():
            raise RuntimeError("Invalid local type-G artifact contents")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        return validate_type_g_artifact(encrypted, manifest)
    repository = os.environ.get("GITHUB_REPOSITORY")
    token = os.environ.get("TYPE_G_ARTIFACT_TOKEN")
    if not repository or not token:
        raise RuntimeError("Missing type-G artifact access configuration")
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "BoatRaceTypeGRunner/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    listing = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/actions/artifacts?name={TYPE_G_ARTIFACT}&per_page=20",
        headers=headers,
    )
    with urllib.request.urlopen(listing, timeout=60) as response:
        artifacts = json.loads(response.read().decode("utf-8")).get("artifacts", [])
    available = [artifact for artifact in artifacts if not artifact.get("expired")]
    if not available:
        raise RuntimeError("No active type-G model artifact")
    artifact = max(available, key=lambda item: item["created_at"])
    request = urllib.request.Request(artifact["archive_download_url"], headers=headers)
    archive_path = destination / "type-g-artifact.zip"
    with urllib.request.urlopen(request, timeout=60) as response, archive_path.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    artifact_dir = destination / "type-g-artifact"
    artifact_dir.mkdir()
    with zipfile.ZipFile(archive_path) as archive:
        expected = {f"{TYPE_G_VERSION}.tar.gz.enc", "manifest.json"}
        if not expected.issubset(set(archive.namelist())):
            raise RuntimeError("Invalid type-G artifact contents")
        for name in expected:
            archive.extract(name, artifact_dir)
    manifest = json.loads((artifact_dir / "manifest.json").read_text(encoding="utf-8"))
    encrypted = artifact_dir / f"{TYPE_G_VERSION}.tar.gz.enc"
    return validate_type_g_artifact(encrypted, manifest)


def validate_type_g_artifact(encrypted: Path, manifest: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    if manifest.get("model_version") != TYPE_G_VERSION:
        raise RuntimeError("type-G model version mismatch")
    if manifest.get("base_model_bundle_sha256") != prepare_forward.MODEL_SHA256:
        raise RuntimeError("type-G base model mismatch")
    if sha_file(encrypted) != manifest.get("encrypted_bundle_sha256"):
        raise RuntimeError("type-G encrypted bundle hash mismatch")
    return encrypted, manifest


def decrypt_type_g(encrypted: Path, manifest: dict[str, Any], destination: Path) -> Any:
    plain = destination / f"{TYPE_G_VERSION}.tar.gz"
    environment = os.environ.copy()
    environment["EDGE_MODEL_KEY"] = os.environ["EDGE_MODEL_KEY"]
    subprocess.run([
        "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000",
        "-in", str(encrypted), "-out", str(plain), "-pass", "env:EDGE_MODEL_KEY",
    ], check=True, env=environment)
    if sha_file(plain) != manifest.get("plain_bundle_sha256"):
        raise RuntimeError("type-G plain bundle hash mismatch")
    extracted = destination / "type-g-model"
    prepare_forward._safe_extract(plain, extracted)
    bundle_manifest = json.loads((extracted / "manifest.json").read_text(encoding="utf-8"))
    if bundle_manifest.get("model_version") != TYPE_G_VERSION:
        raise RuntimeError("type-G bundle manifest mismatch")
    return joblib.load(extracted / "stage1.joblib"), bundle_manifest


def type_g_matrix(frame: pd.DataFrame) -> np.ndarray:
    roster = set(json.loads((ROOT / "validation/female_racer_ids.json").read_text(encoding="utf-8")))
    return np.column_stack([
        pd.to_numeric(frame[f"b{lane}_racer_id"], errors="coerce").fillna(-1).astype(int).isin(roster)
        for lane in range(1, 7)
    ]).astype(np.float32)


def augmented_stage1_x(boats: np.ndarray, context: np.ndarray, type_g: np.ndarray) -> np.ndarray:
    n = len(boats)
    candidate = type_g.reshape(n * 6, 1)
    count = type_g.sum(axis=1, keepdims=True)
    mixed = ((count > 0) & (count < 6)).astype(np.float32)
    field = np.concatenate([count / 6.0, mixed, (count == 6).astype(np.float32)], axis=1)
    base = np.concatenate([boats.reshape(n * 6, -1), np.repeat(context, 6, axis=0)], axis=1)
    extra = np.concatenate([candidate, np.repeat(field, 6, axis=0), candidate * np.repeat(mixed, 6, axis=0)], axis=1)
    return np.concatenate([base, extra], axis=1).astype(np.float32)


def predict_type_g(frame: pd.DataFrame, stage1: Any, morning_model: Any, hybrid_forward: Any, model_module: Any) -> pd.DataFrame:
    boats, context, _, _ = hybrid_forward.build_morning_feature_tensors(frame)
    raw = stage1.predict_proba(augmented_stage1_x(boats, context, type_g_matrix(frame)))[:, 1].reshape(len(frame), 6)
    p1 = np.divide(raw, raw.sum(axis=1, keepdims=True), out=np.zeros_like(raw), where=raw.sum(axis=1, keepdims=True) > 0)
    _, p2, p3 = morning_model.predict_components(boats, context)
    trifecta = model_module.components_to_trifecta(p1, p2, p3)
    order = np.argsort(-trifecta, axis=1)
    output = frame[["race_id", "race_date", "venue", "race_number", "deadline_at"]].reset_index(drop=True).copy()
    for rank in range(1, 9):
        index = order[:, rank - 1]
        triple = model_module.TRIPLES[index] + 1
        output[f"top{rank}_combo"] = ["-".join(map(str, row)) for row in triple]
        output[f"top{rank}_score"] = trifecta[np.arange(len(frame)), index]
    output["morning_score"] = np.take_along_axis(trifecta, order[:, :5], axis=1).sum(axis=1)
    return output


def prediction_record(prediction: pd.Series, race: dict[str, Any], published_at: str, mode: str) -> dict[str, Any]:
    combinations = [str(prediction[f"top{rank}_combo"]) for rank in range(1, 9)]
    is_type_g = mode != "type_g_control_v1"
    model_version = TYPE_G_VERSION if is_type_g else prepare_forward.MODEL_VERSION
    strategy = {
        "type_g_shadow_v1": "type-g-dynamic10-v1",
        "type_g_control_v1": "type-g-control-v1",
        "type_g_on_hit_v1": "type-g-on-hit-v1",
    }[mode]
    identity = {"race_id": race["race_id"], "model": model_version, "mode": mode, "combinations": combinations}
    record: dict[str, Any] = {
        "prediction_id": "pred_" + sha_bytes(canonical(identity))[:20],
        "race_id": race["race_id"],
        "model_version": model_version,
        "strategy_version": strategy,
        "selection_score": int(round(float(prediction["morning_score"]) * 100)),
        "selection_reasons": [
            "現行HITと同じ朝データで計算",
            "type-G検証用として別集計",
            "オッズ・払戻を使わず買い目を固定",
        ],
        "ranking": prepare_forward._ranking(prediction, race),
        "tickets": [{"bet_type": "trifecta", "combination": combo, "stake_yen": 100} for combo in combinations],
        "virtual_stake_yen": 300,
        "published_at": published_at,
        "publication_mode": mode,
        "official_performance_eligible": False,
    }
    record["publication_hash"] = sha_bytes(canonical(record))
    return record


def main(session_root: Path | None = None) -> None:
    date = os.environ.get("EDGE_SERVICE_DATE") or datetime.now(prepare_forward.JST).date().isoformat()
    state_path = ROOT / "state" / TYPE_G_VERSION / f"{date}.json"
    payload_path = ROOT / ".runtime" / "type-g-payload.json"
    source_data_root: Path | None = None
    payload_path.unlink(missing_ok=True)
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
    else:
        now = pd.Timestamp(os.environ.get("TYPE_G_NOW") or datetime.now(timezone.utc))
        if now.tz_convert("Asia/Tokyo").time() > prepare_forward.MORNING_LOCK_DEADLINE:
            return
        temporary_root = session_root or Path(tempfile.mkdtemp(prefix="type-g-forward-"))
        data_root = prepare_forward._clone_data(temporary_root / "boatracecsv", date)
        source_data_root = data_root
        encrypted_base = temporary_root / prepare_forward.MODEL_FILENAME
        plain_base = temporary_root / "W_morning_badge_v1.tar.gz"
        extracted_base = temporary_root / "model"
        if not extracted_base.exists():
            prepare_forward._download_model(encrypted_base)
            prepare_forward._decrypt_model(encrypted_base, plain_base)
            prepare_forward._safe_extract(plain_base, extracted_base)
        if str(extracted_base) not in sys.path:
            sys.path.insert(0, str(extracted_base))
        from edge_research import hybrid_forward, models as model_module

        manifest, frozen, _, _ = hybrid_forward.load_frozen(extracted_base / "artifacts" / "frozen_w_morning_badge_v1")
        encrypted_type_g, artifact_manifest = download_type_g_artifact(temporary_root)
        stage1, type_g_manifest = decrypt_type_g(encrypted_type_g, artifact_manifest, temporary_root)
        # A local artifact is only used by the workflow's historical smoke test.
        # The live artifact path always enforces the genuine-forward start date.
        historical_smoke = bool(os.environ.get("TYPE_G_ARTIFACT_PATH"))
        if date < type_g_manifest["genuine_forward_not_before"] and not historical_smoke:
            print(json.dumps({"type_g_skip": "before_forward_start", "date": date}), flush=True)
            return
        if manifest["training_end"] != type_g_manifest["base_training_end"]:
            print(json.dumps({"type_g_skip": "base_training_mismatch", "loaded": manifest["training_end"], "expected": type_g_manifest["base_training_end"]}), flush=True)
            return
        schedule = prepare_forward._load_service_day_compatible(hybrid_forward, data_root, date)
        candidates = prepare_forward._morning_candidates(schedule, now)
        if len(candidates) < prepare_forward.DAILY_CAP:
            print(json.dumps({"type_g_skip": "insufficient_open_races", "candidates": len(candidates)}), flush=True)
            return
        cards, titles = prepare_forward._load_cards(data_root, date)
        control = hybrid_forward.predict_morning(candidates, frozen["morning"])
        type_g = predict_type_g(candidates, stage1, frozen["morning"], hybrid_forward, model_module)
        control_by_id = {str(row.race_id): pd.Series(row._asdict()) for row in control.itertuples(index=False)}
        type_g_by_id = {str(row.race_id): pd.Series(row._asdict()) for row in type_g.itertuples(index=False)}
        type_g_selected = type_g.sort_values(["morning_score", "race_id"], ascending=[False, True]).head(prepare_forward.DAILY_CAP)
        official_state_path = ROOT / "state" / prepare_forward.MODEL_VERSION / f"{date}.json"
        official_ids = []
        if official_state_path.exists():
            official_state = json.loads(official_state_path.read_text(encoding="utf-8"))
            official_ids = [str(item["race_id_raw"]) for item in official_state.get("selected", [])]

        selected = []
        for row in type_g_selected.itertuples(index=False):
            raw_id = str(row.race_id)
            source = schedule.loc[schedule["race_id"].eq(raw_id)].iloc[0]
            race = prepare_forward._race_record(source, cards, titles)
            for prediction, mode in ((pd.Series(row._asdict()), "type_g_shadow_v1"), (control_by_id[raw_id], "type_g_control_v1")):
                selected.append({"race_id_raw": raw_id, "race": race, "prediction": prediction_record(prediction, race, now.isoformat(), mode)})
        for raw_id in official_ids:
            if raw_id not in type_g_by_id:
                continue
            source = schedule.loc[schedule["race_id"].eq(raw_id)].iloc[0]
            race = prepare_forward._race_record(source, cards, titles)
            selected.append({"race_id_raw": raw_id, "race": race, "prediction": prediction_record(type_g_by_id[raw_id], race, now.isoformat(), "type_g_on_hit_v1")})
        state = {
            "schema_version": TYPE_G_STATE_SCHEMA,
            "date": date,
            "model_version": TYPE_G_VERSION,
            "selected": selected,
            "published_count": 0,
            "morning_locked_at": now.isoformat(),
            "model_artifact_created_at": artifact_manifest["created_at"],
        }
        prepare_forward._atomic_json(state_path, state)

    published_count = min(int(state.get("published_count", 0)), len(state.get("selected", [])))
    pending = state.get("selected", [])[published_count:]
    if not pending:
        return
    races = list({item["race"]["race_id"]: item["race"] for item in pending}.values())
    generated_at = datetime.now(timezone.utc).isoformat()
    if source_data_root is None:
        if session_root is not None:
            source_data_root = session_root / "boatracecsv" / "data"
        else:
            fallback_root = Path(tempfile.mkdtemp(prefix="type-g-sources-"))
            source_data_root = prepare_forward._clone_data(fallback_root / "boatracecsv", date)
    artifacts = [
        prepare_forward._artifact(source_data_root, "programs/race_cards", "race_cards", date, generated_at),
        prepare_forward._artifact(source_data_root, "programs/title", "title", date, generated_at),
    ]
    payload = {
        "schema_version": prepare_forward.PAYLOAD_SCHEMA,
        "stream": "type_g",
        "generated_at": generated_at,
        "service_date": date,
        "artifacts": [item for item in artifacts if item is not None],
        "races": races,
        "decisions": [{
            "race_id": item["prediction"]["race_id"],
            "model_version": item["prediction"]["model_version"],
            "score": item["prediction"]["selection_score"],
            "decision": "recommend",
            "reasons": item["prediction"]["selection_reasons"],
        } for item in pending],
        "predictions": [item["prediction"] for item in pending],
        "reassessments": [],
        "edge_candidates": [],
        "results": [],
    }
    if not payload["artifacts"]:
        raise RuntimeError("type-G source artifact is unavailable")
    prepare_forward._atomic_json(payload_path, payload)
    print(json.dumps({"date": date, "type_g_records": len(state["selected"]), "pending": len(pending)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
