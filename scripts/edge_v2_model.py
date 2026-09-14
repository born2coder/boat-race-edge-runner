"""Expose the frozen model's full distribution without retraining or changing HIT."""
from __future__ import annotations

import numpy as np
import pandas as pd


class CaptureDistribution:
    def __init__(self, model):
        self.model = model
        self.calls = []

    def __getattr__(self, name):
        return getattr(self.model, name)

    def predict_trifecta(self, *args, **kwargs):
        probabilities = self.model.predict_trifecta(*args, **kwargs)
        self.calls.append(np.array(probabilities, dtype=float, copy=True))
        return probabilities


def validate_distribution(values, combinations):
    from itertools import permutations
    expected = {"-".join(map(str, p)) for p in permutations(range(1, 7), 3)}
    array = np.asarray(values, dtype=float)
    if len(combinations) != 120 or set(combinations) != expected:
        raise ValueError("Full distribution requires 120 distinct trifectas")
    if array.shape != (120,) or not np.isfinite(array).all() or (array < 0).any():
        raise ValueError("Invalid full probability distribution")
    if not np.isclose(array.sum(), 1.0, atol=1e-6, rtol=0):
        raise ValueError("Full probability mass must sum to one")
    return [float(x) for x in array]


def predict_full(frame, model, hybrid, model_module, kind, now, diagnostics=None):
    """Use the original inference and safety metadata, capture before top8 truncation.

    Fail closed if the frozen interface changes: no fabricated lower-ranked mass.
    All top8 scores are checked against the original output on every invocation.
    """
    if frame.empty:
        return {}
    proxy = CaptureDistribution(model)
    prediction = getattr(hybrid, f"predict_{kind}")(frame, proxy)
    if prediction.empty:
        if diagnostics is not None:
            diagnostics.update({str(rid): "model_input_incomplete" for rid in frame["race_id"]})
        return {}
    if not proxy.calls:
        raise RuntimeError("Frozen model did not expose predict_trifecta; contract check failed")
    probabilities = np.concatenate(proxy.calls, axis=0)
    if probabilities.shape != (len(prediction), 120):
        raise RuntimeError("Full-distribution row alignment failed")
    combinations = ["-".join(map(str, row)) for row in (model_module.TRIPLES + 1)]
    positions = {combo: i for i, combo in enumerate(combinations)}
    result = {}
    for index, (_, row) in enumerate(prediction.iterrows()):
        values = validate_distribution(probabilities[index], combinations)
        for rank in range(1, 9):
            score = values[positions[str(row[f"top{rank}_combo"])]]
            if not np.isclose(score, float(row[f"top{rank}_score"]), atol=1e-8, rtol=1e-6):
                raise RuntimeError("Original top8 differs from full distribution")
        ready = None
        if kind == "exhibition":
            ready = pd.to_datetime(row.get("source_ready_at"), errors="coerce", utc=True)
            cutoff = pd.to_datetime(row.get("safe_cutoff_at"), errors="coerce", utc=True)
            if not bool(row.get("source_safe", False)) or pd.isna(ready) or pd.isna(cutoff):
                if diagnostics is not None:
                    diagnostics[str(row["race_id"])] = "source_missing_or_unsafe"
                continue
            if ready > now or now >= cutoff:
                if diagnostics is not None:
                    diagnostics[str(row["race_id"])] = "source_from_future" if ready > now else "safety_cutoff_passed"
                continue
        result[str(row["race_id"])] = {
            "probabilities": values,
            "combinations": combinations,
            "source_ready_at": ready.isoformat() if ready is not None else None,
            "top8": [str(row[f"top{rank}_combo"]) for rank in range(1, 9)],
        }
    return result
