#!/usr/bin/env python3
from __future__ import annotations

import inspect
import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from scripts import prepare_forward


SENSITIVE = ("token", "secret", "password", "passphrase", "key")


def safe(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "<max-depth>"
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            label = str(key)
            out[label] = "<redacted>" if any(word in label.lower() for word in SENSITIVE) else safe(item, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [safe(item, depth + 1) for item in value[:200]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return repr(value)[:500]


def describe_reference(value: Any) -> dict[str, Any]:
    description: dict[str, Any] = {"type": type(value).__name__}
    if hasattr(value, "shape"):
        description["shape"] = list(value.shape)
    if hasattr(value, "columns"):
        description["columns"] = [str(column) for column in value.columns]
        for column in ("race_date", "date", "month", "race_id"):
            if column in value.columns and len(value):
                series = value[column].astype(str)
                description[f"{column}_min"] = series.min()
                description[f"{column}_max"] = series.max()
    if isinstance(value, dict):
        description["keys"] = sorted(str(key) for key in value)
    return description


def main() -> None:
    output_path = Path(os.environ.get("EDGE_AUDIT_OUTPUT", "validation-output/production-model-audit.json"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="edge-model-audit-") as temporary:
        root = Path(temporary)
        encrypted = root / prepare_forward.MODEL_FILENAME
        plaintext = root / "model.tar.gz"
        extracted = root / "model"
        prepare_forward._download_model(encrypted)
        prepare_forward._decrypt_model(encrypted, plaintext)
        prepare_forward._safe_extract(plaintext, extracted)
        sys.path.insert(0, str(extracted))

        from edge_research import build_dataset, features, hybrid_forward, models

        artifact_dir = extracted / "artifacts" / "frozen_w_morning_badge_v1"
        manifest, models, morning_reference, exhibition_reference = hybrid_forward.load_frozen(artifact_dir)
        module_dir = Path(hybrid_forward.__file__).resolve().parent
        python_files = sorted(path.name for path in module_dir.glob("*.py"))
        source_flags = {}
        for path in module_dir.glob("*.py"):
            source = path.read_text(encoding="utf-8", errors="replace").lower()
            source_flags[path.name] = {
                "mentions_gender": "gender" in source,
                "mentions_female": "female" in source,
                "mentions_sex": "sex" in source,
                "mentions_japanese_women": "女子" in source,
            }

        module_callables = {}
        for module in (build_dataset, features, hybrid_forward, models):
            callables = {}
            for name in sorted(dir(module)):
                value = getattr(module, name)
                if callable(value) and not name.startswith("_"):
                    try:
                        callables[name] = str(inspect.signature(value))
                    except (TypeError, ValueError):
                        callables[name] = "<unknown>"
            module_callables[module.__name__] = callables
        conditional_methods = {}
        for name in sorted(dir(models.ConditionalModel)):
            value = getattr(models.ConditionalModel, name)
            if callable(value) and not name.startswith("_"):
                try:
                    conditional_methods[name] = str(inspect.signature(value))
                except (TypeError, ValueError):
                    conditional_methods[name] = "<unknown>"

        model_summary = {}
        for key, model in models.items():
            details = {"type": f"{type(model).__module__}.{type(model).__name__}"}
            for attr in ("n_features_in_", "classes_", "feature_names_in_"):
                if hasattr(model, attr):
                    details[attr] = safe(getattr(model, attr))
            if hasattr(model, "__dict__"):
                details["attributes"] = sorted(str(name) for name in model.__dict__.keys())
            model_summary[str(key)] = details

        audit_date = os.environ.get("EDGE_AUDIT_DATE", datetime.utcnow().date().isoformat())
        data_root = prepare_forward._clone_data(root / "boatracecsv", audit_date)
        schedule = prepare_forward._load_service_day_compatible(hybrid_forward, data_root, audit_date)
        predictions = hybrid_forward.predict_morning(schedule, models["morning"])

        result = {
            "audit_schema": "boat-race-edge-production-model-audit/v1",
            "model_filename": prepare_forward.MODEL_FILENAME,
            "model_version": prepare_forward.MODEL_VERSION,
            "bundle_sha256": prepare_forward.MODEL_SHA256,
            "manifest": safe(manifest),
            "model_summary": model_summary,
            "morning_reference": describe_reference(morning_reference),
            "exhibition_reference": describe_reference(exhibition_reference),
            "module_files": python_files,
            "source_gender_flags": source_flags,
            "module_callables": module_callables,
            "conditional_model_methods": conditional_methods,
            "feature_constants": {
                "boat_fields": safe(getattr(features, "BOAT_FIELDS", None)),
                "relative_fields": safe(getattr(features, "RELATIVE_FIELDS", None)),
                "morning_boat_fields": safe(getattr(hybrid_forward, "MORNING_BOAT_FIELDS", None)),
                "morning_relative_fields": safe(getattr(hybrid_forward, "MORNING_RELATIVE_FIELDS", None)),
            },
            "audit_prediction": {
                "date": audit_date,
                "schedule_shape": list(schedule.shape),
                "schedule_columns": [str(column) for column in schedule.columns],
                "prediction_shape": list(predictions.shape),
                "prediction_columns": [str(column) for column in predictions.columns],
            },
        }
        output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
        print("EDGE_MODEL_AUDIT_BEGIN")
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        print("EDGE_MODEL_AUDIT_END")


if __name__ == "__main__":
    main()
