#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import prepare_forward

MODEL_VERSION = "HIT_type_G_v1"
TRAINING_START = "2025-11-01"
TRAINING_END = "2026-08-31"
GENDER_FEATURES = [
    "candidate_type_g",
    "type_g_share",
    "mixed_field",
    "all_type_g",
    "candidate_type_g_x_mixed",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clone_history(destination: Path) -> Path:
    subprocess.run([
        "git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
        prepare_forward.UPSTREAM, str(destination),
    ], check=True, timeout=180)
    paths = []
    for period in pd.period_range("2025-11", "2026-08", freq="M"):
        for family in ("programs/race_cards", "results/realtime"):
            paths.append(f"data/{family}/{period.year:04d}/{period.month:02d}")
    subprocess.run([
        "git", "-C", str(destination), "sparse-checkout", "set", *paths,
    ], check=True, timeout=300)
    return destination / "data"


def type_g_matrix(frame: pd.DataFrame, roster: set[int]) -> np.ndarray:
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
    extra = np.concatenate([
        candidate,
        np.repeat(field, 6, axis=0),
        candidate * np.repeat(mixed, 6, axis=0),
    ], axis=1)
    base = np.concatenate([boats.reshape(n * 6, -1), np.repeat(context, 6, axis=0)], axis=1)
    return np.concatenate([base, extra], axis=1).astype(np.float32)


def main() -> None:
    output_dir = Path(os.environ.get("TYPE_G_OUTPUT", "validation-output/type-g-model"))
    output_dir.mkdir(parents=True, exist_ok=True)
    roster_path = ROOT / "validation/female_racer_ids.json"
    roster = set(json.loads(roster_path.read_text(encoding="utf-8")))

    with tempfile.TemporaryDirectory(prefix="type-g-training-") as temporary:
        temporary_root = Path(temporary)
        encrypted_base = temporary_root / prepare_forward.MODEL_FILENAME
        plain_base = temporary_root / "base.tar.gz"
        extracted_base = temporary_root / "base"
        prepare_forward._download_model(encrypted_base)
        prepare_forward._decrypt_model(encrypted_base, plain_base)
        prepare_forward._safe_extract(plain_base, extracted_base)
        sys.path.insert(0, str(extracted_base))

        from edge_research import build_dataset, hybrid_forward

        manifest, frozen, _, _ = hybrid_forward.load_frozen(
            extracted_base / "artifacts" / "frozen_w_morning_badge_v1"
        )
        data_root = clone_history(temporary_root / "boatracecsv")
        frame = build_dataset.build_dataset(data_root, TRAINING_START, TRAINING_END)
        boats, context, _, _ = hybrid_forward.build_morning_feature_tensors(frame)
        type_g = type_g_matrix(frame, roster)
        finish_1 = frame["finish_1"].to_numpy(np.int8) - 1
        lanes = np.tile(np.arange(6), len(frame))
        target = (lanes == np.repeat(finish_1, 6)).astype(np.int8)

        stage1 = clone(frozen["morning"].stage1)
        stage1.fit(augmented_stage1_x(boats, context, type_g), target)

        bundle = temporary_root / "bundle"
        bundle.mkdir()
        joblib.dump(stage1, bundle / "stage1.joblib", compress=3)
        type_g_manifest = {
            "model_version": MODEL_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "training_start": TRAINING_START,
            "training_end": TRAINING_END,
            "training_races": len(frame),
            "genuine_forward_not_before": "2026-09-08",
            "base_model_version": prepare_forward.MODEL_VERSION,
            "base_model_bundle_sha256": prepare_forward.MODEL_SHA256,
            "base_training_end": manifest["training_end"],
            "changed_component": "stage1_only",
            "gender_features": GENDER_FEATURES,
            "roster_sha256": hashlib.sha256(roster_path.read_bytes()).hexdigest(),
        }
        (bundle / "manifest.json").write_text(
            json.dumps(type_g_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        plain_bundle = temporary_root / f"{MODEL_VERSION}.tar.gz"
        with tarfile.open(plain_bundle, "w:gz") as archive:
            archive.add(bundle / "stage1.joblib", arcname="stage1.joblib")
            archive.add(bundle / "manifest.json", arcname="manifest.json")
        encrypted_bundle = output_dir / f"{MODEL_VERSION}.tar.gz.enc"
        environment = os.environ.copy()
        environment["EDGE_MODEL_KEY"] = os.environ["EDGE_MODEL_KEY"]
        subprocess.run([
            "openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-iter", "200000",
            "-in", str(plain_bundle), "-out", str(encrypted_bundle), "-pass", "env:EDGE_MODEL_KEY",
        ], check=True, env=environment)
        (output_dir / "manifest.json").write_text(
            json.dumps({
                **type_g_manifest,
                "plain_bundle_sha256": sha256(plain_bundle),
                "encrypted_bundle_sha256": sha256(encrypted_bundle),
                "encrypted_bundle_bytes": encrypted_bundle.stat().st_size,
            }, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({
            "model_version": MODEL_VERSION,
            "training_races": len(frame),
            "plain_bundle_sha256": sha256(plain_bundle),
            "encrypted_bundle_sha256": sha256(encrypted_bundle),
            "encrypted_bundle_bytes": encrypted_bundle.stat().st_size,
        }))


if __name__ == "__main__":
    main()
