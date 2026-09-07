#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from calendar import monthrange
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.base import clone

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from scripts import prepare_forward


SEED = 20260907
TOP_K = (1, 3, 5, 8)
ROLLING_MONTHS = [f"2026-{month:02d}" for month in range(1, 9)]


def clone_history(destination: Path) -> Path:
    subprocess.run([
        "git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
        prepare_forward.UPSTREAM, str(destination),
    ], check=True, timeout=180)
    paths: list[str] = []
    for period in pd.period_range("2025-11", "2026-09", freq="M"):
        for family in ("programs/race_cards", "results/realtime", "results/payouts"):
            paths.append(f"data/{family}/{period.year:04d}/{period.month:02d}")
    subprocess.run([
        "git", "-C", str(destination), "sparse-checkout", "set", *paths,
    ], check=True, timeout=300)
    return destination / "data"


def gender_matrix(frame: pd.DataFrame, female_ids: set[int]) -> np.ndarray:
    cols = []
    for lane in range(1, 7):
        racer_id = pd.to_numeric(frame[f"b{lane}_racer_id"], errors="coerce").fillna(-1).astype(int)
        cols.append(racer_id.isin(female_ids).to_numpy(np.float32))
    return np.column_stack(cols).astype(np.float32)


def challenger_xy(boats: np.ndarray, context: np.ndarray, female: np.ndarray) -> np.ndarray:
    n = len(boats)
    candidate = female.reshape(n * 6, 1)
    female_count = female.sum(axis=1, keepdims=True)
    mixed = ((female_count > 0) & (female_count < 6)).astype(np.float32)
    all_female = (female_count == 6).astype(np.float32)
    race_features = np.concatenate([
        female_count / 6.0,
        mixed,
        all_female,
    ], axis=1)
    extras = np.concatenate([
        candidate,
        np.repeat(race_features, 6, axis=0),
        candidate * np.repeat(mixed, 6, axis=0),
    ], axis=1)
    base = np.concatenate([
        boats.reshape(n * 6, -1),
        np.repeat(context, 6, axis=0),
    ], axis=1)
    return np.concatenate([base, extras], axis=1).astype(np.float32)


def normalize(values: np.ndarray) -> np.ndarray:
    total = values.sum(axis=1, keepdims=True)
    return np.divide(values, total, out=np.zeros_like(values), where=total > 0)


def challenger_p1(estimator: Any, boats: np.ndarray, context: np.ndarray, female: np.ndarray) -> np.ndarray:
    raw = estimator.predict_proba(challenger_xy(boats, context, female))[:, 1].reshape(len(boats), 6)
    return normalize(raw)


def outcome_rank(scores: np.ndarray, triples: np.ndarray, f1: np.ndarray, f2: np.ndarray, f3: np.ndarray) -> np.ndarray:
    lookup = {tuple(map(int, triple)): index for index, triple in enumerate(triples)}
    actual = np.asarray([lookup[(int(a), int(b), int(c))] for a, b, c in zip(f1, f2, f3, strict=True)])
    order = np.argsort(-scores, axis=1)
    return np.asarray([int(np.flatnonzero(row == target)[0]) + 1 for row, target in zip(order, actual, strict=True)])


def race_metrics(
    frame: pd.DataFrame,
    model_name: str,
    p1: np.ndarray,
    trifecta: np.ndarray,
    triples: np.ndarray,
) -> pd.DataFrame:
    f1 = frame["finish_1"].to_numpy(int) - 1
    f2 = frame["finish_2"].to_numpy(int) - 1
    f3 = frame["finish_3"].to_numpy(int) - 1
    rank = outcome_rank(trifecta, triples, f1, f2, f3)
    order = np.argsort(-trifecta, axis=1)
    rows = pd.DataFrame({
        "model": model_name,
        "race_date": pd.to_datetime(frame["race_date"]).dt.strftime("%Y-%m-%d").to_numpy(),
        "month": pd.to_datetime(frame["race_date"]).dt.strftime("%Y-%m").to_numpy(),
        "payout": pd.to_numeric(frame["trifecta_payout"], errors="coerce").fillna(0).to_numpy(float),
        "actual_rank": rank,
        "winner_hit": np.argmax(p1, axis=1) == f1,
        "winner_log_loss": -np.log(np.clip(p1[np.arange(len(p1)), f1], 1e-12, 1.0)),
        "winner_brier": np.sum((p1 - np.eye(6)[f1]) ** 2, axis=1),
        "top5_mass": np.take_along_axis(trifecta, order[:, :5], axis=1).sum(axis=1),
    })
    for k in TOP_K:
        rows[f"hit_top{k}"] = rank <= k
        rows[f"return_top{k}"] = np.where(rank <= k, rows["payout"], 0.0)
    return rows


def aggregate(rows: pd.DataFrame) -> dict[str, Any]:
    result: dict[str, Any] = {
        "races": int(len(rows)),
        "days": int(rows["race_date"].nunique()),
        "winner_accuracy": float(rows["winner_hit"].mean()),
        "winner_log_loss": float(rows["winner_log_loss"].mean()),
        "winner_brier": float(rows["winner_brier"].mean()),
    }
    for k in TOP_K:
        result[f"top{k}_accuracy"] = float(rows[f"hit_top{k}"].mean())
        result[f"top{k}_roi"] = float(rows[f"return_top{k}"].sum() / (len(rows) * k * 100))
    return result


def daily10(rows: pd.DataFrame) -> pd.DataFrame:
    return (
        rows.sort_values(["race_date", "top5_mass"], ascending=[True, False])
        .groupby("race_date", sort=False, as_index=False)
        .head(10)
        .copy()
    )


def paired_bootstrap(base: pd.DataFrame, challenger: pd.DataFrame, reps: int = 2000) -> dict[str, Any]:
    metrics = ["winner_hit", "winner_log_loss", "winner_brier"] + [f"hit_top{k}" for k in TOP_K]
    joined = base.reset_index(drop=True).copy()
    other = challenger.reset_index(drop=True)
    joined["day"] = joined["race_date"]
    for metric in metrics:
        joined[f"delta_{metric}"] = other[metric].astype(float) - joined[metric].astype(float)
    daily = joined.groupby("day")[[f"delta_{metric}" for metric in metrics]].mean()
    rng = np.random.default_rng(SEED)
    take = rng.integers(0, len(daily), size=(reps, len(daily)))
    sims = daily.to_numpy()[take].mean(axis=1)
    output: dict[str, Any] = {}
    for index, metric in enumerate(metrics):
        point = float(joined[f"delta_{metric}"].mean())
        lo, hi = np.quantile(sims[:, index], [0.025, 0.975])
        output[metric] = {"delta": point, "ci95": [float(lo), float(hi)]}
    return output


def gender_calibration(frame: pd.DataFrame, female: np.ndarray, p1: np.ndarray) -> dict[str, Any]:
    count = female.sum(axis=1)
    mixed = (count > 0) & (count < 6)
    lane1_female = female[:, 0].astype(bool)
    actual_lane1 = frame["finish_1"].to_numpy(int) == 1
    target = mixed & lane1_female
    female_actual = np.asarray([female[row, lane - 1] for row, lane in enumerate(frame["finish_1"].to_numpy(int))])
    return {
        "mixed_races": int(mixed.sum()),
        "mixed_female_lane1_races": int(target.sum()),
        "mixed_female_lane1_expected_wins": float(p1[target, 0].sum()),
        "mixed_female_lane1_actual_wins": int(actual_lane1[target].sum()),
        "mixed_female_lane1_oe": float(actual_lane1[target].sum() / p1[target, 0].sum()) if p1[target, 0].sum() else None,
        "mixed_predicted_female_wins": float((p1 * female)[mixed].sum()),
        "mixed_actual_female_wins": int(female_actual[mixed].sum()),
    }


def markdown_report(result: dict[str, Any]) -> str:
    lines = [
        "# 運用中HITモデル 性別影響検証",
        "",
        "## 検証設計",
        "",
        "- 現行: 本番と同じ ConditionalModel と朝時点特徴量。",
        "- 修正版: 2着・3着段は現行と同一で、1着段だけに性別・女子人数・混合戦フラグを追加。",
        "- 過去比較: 各月より前のデータだけで学習する月次ローリング検証。",
        "- 本番凍結モデル: 学習終了翌日の 2026-09-05 以降だけを genuine forward として別集計。",
        "- 比較点数: Top1 / Top3 / Top5 / Top8。日次選抜は各方式とも最大10レース。",
        "",
        "## 全ローリング期間",
        "",
        "| 指標 | 現行 | 性別考慮 | 差 |",
        "|---|---:|---:|---:|",
    ]
    base = result["rolling"]["all"]["current"]
    challenger = result["rolling"]["all"]["gender_stage1"]
    for label, key in (("1着艇的中率", "winner_accuracy"), ("1着log loss", "winner_log_loss"), ("Top1", "top1_accuracy"), ("Top3", "top3_accuracy"), ("Top5", "top5_accuracy"), ("Top8", "top8_accuracy")):
        lines.append(f"| {label} | {base[key]:.4f} | {challenger[key]:.4f} | {challenger[key]-base[key]:+.4f} |")
    lines.extend(["", "## 日次10レース", "", "| 指標 | 現行 | 性別考慮 | 差 |", "|---|---:|---:|---:|"])
    base = result["rolling"]["daily10"]["current"]
    challenger = result["rolling"]["daily10"]["gender_stage1"]
    for label, key in (("Top1", "top1_accuracy"), ("Top3", "top3_accuracy"), ("Top5", "top5_accuracy"), ("Top8", "top8_accuracy"), ("Top3回収率", "top3_roi"), ("Top5回収率", "top5_roi")):
        lines.append(f"| {label} | {base[key]:.4f} | {challenger[key]:.4f} | {challenger[key]-base[key]:+.4f} |")
    lines.extend(["", "## 判断", "", result["decision"], ""])
    return "\n".join(lines)


def main() -> None:
    output_dir = Path(os.environ.get("EDGE_VALIDATION_OUTPUT", "validation-output/production-gender"))
    output_dir.mkdir(parents=True, exist_ok=True)
    female_ids = set(json.loads((REPO_ROOT / "validation/female_racer_ids.json").read_text(encoding="utf-8")))

    with tempfile.TemporaryDirectory(prefix="edge-production-gender-") as temporary:
        root = Path(temporary)
        encrypted = root / prepare_forward.MODEL_FILENAME
        plaintext = root / "model.tar.gz"
        extracted = root / "model"
        prepare_forward._download_model(encrypted)
        prepare_forward._decrypt_model(encrypted, plaintext)
        prepare_forward._safe_extract(plaintext, extracted)
        sys.path.insert(0, str(extracted))

        from edge_research import build_dataset, hybrid_forward, models

        artifact_dir = extracted / "artifacts" / "frozen_w_morning_badge_v1"
        manifest, frozen, _, _ = hybrid_forward.load_frozen(artifact_dir)
        data_root = clone_history(root / "boatracecsv")
        end = os.environ.get("EDGE_VALIDATION_END", "2026-09-07")
        history = build_dataset.build_dataset(data_root, "2025-11-01", end)
        history = history.sort_values(["race_date", "venue", "race_number"]).reset_index(drop=True)
        female_all = gender_matrix(history, female_ids)

        race_parts: list[pd.DataFrame] = []
        calibration: list[dict[str, Any]] = []
        monthly_rows: list[dict[str, Any]] = []
        for month in ROLLING_MONTHS:
            period = pd.Period(month, freq="M")
            test_start = pd.Timestamp(period.start_time)
            test_end = pd.Timestamp(period.end_time).normalize()
            train_mask = history["race_date"] < test_start
            test_mask = history["race_date"].between(test_start, test_end)
            train = history.loc[train_mask].copy()
            test = history.loc[test_mask].copy()
            if train.empty or test.empty:
                continue
            train_boats, train_context, _, _ = hybrid_forward.build_morning_feature_tensors(train)
            test_boats, test_context, _, _ = hybrid_forward.build_morning_feature_tensors(test)
            train_female = female_all[train_mask.to_numpy()]
            test_female = female_all[test_mask.to_numpy()]
            finish = [train[f"finish_{place}"].to_numpy(np.int8) - 1 for place in (1, 2, 3)]

            current = models.ConditionalModel(random_state=SEED).fit(train_boats, train_context, *finish)
            current_p1, current_p2, current_p3 = current.predict_components(test_boats, test_context)
            current_tri = models.components_to_trifecta(current_p1, current_p2, current_p3)

            stage1 = clone(current.stage1)
            x_train = challenger_xy(train_boats, train_context, train_female)
            lanes = np.tile(np.arange(6), len(train))
            y_train = (lanes == np.repeat(finish[0], 6)).astype(np.int8)
            stage1.fit(x_train, y_train)
            gender_p1 = challenger_p1(stage1, test_boats, test_context, test_female)
            gender_tri = models.components_to_trifecta(gender_p1, current_p2, current_p3)

            current_rows = race_metrics(test, "current", current_p1, current_tri, models.TRIPLES)
            gender_rows = race_metrics(test, "gender_stage1", gender_p1, gender_tri, models.TRIPLES)
            race_parts.extend([current_rows, gender_rows])
            monthly_rows.extend([
                {"month": month, "model": "current", **aggregate(current_rows)},
                {"month": month, "model": "gender_stage1", **aggregate(gender_rows)},
            ])
            calibration.extend([
                {"month": month, "model": "current", **gender_calibration(test, test_female, current_p1)},
                {"month": month, "model": "gender_stage1", **gender_calibration(test, test_female, gender_p1)},
            ])
            print(f"validated month={month} train={len(train)} test={len(test)}", flush=True)

        races = pd.concat(race_parts, ignore_index=True)
        current_rows = races[races["model"] == "current"].reset_index(drop=True)
        gender_rows = races[races["model"] == "gender_stage1"].reset_index(drop=True)
        current_daily10 = daily10(current_rows)
        gender_daily10 = daily10(gender_rows)

        genuine_mask = history["race_date"] >= pd.Timestamp(manifest["genuine_forward_not_before"])
        genuine = history.loc[genuine_mask].copy()
        genuine_result: dict[str, Any]
        if genuine.empty:
            genuine_result = {"status": "no_finalized_races"}
        else:
            genuine_boats, genuine_context, _, _ = hybrid_forward.build_morning_feature_tensors(genuine)
            genuine_p1, genuine_p2, genuine_p3 = frozen["morning"].predict_components(genuine_boats, genuine_context)
            genuine_tri = models.components_to_trifecta(genuine_p1, genuine_p2, genuine_p3)
            genuine_rows = race_metrics(genuine, "frozen_production", genuine_p1, genuine_tri, models.TRIPLES)
            genuine_result = {
                "period_start": str(pd.to_datetime(genuine["race_date"]).min().date()),
                "period_end": str(pd.to_datetime(genuine["race_date"]).max().date()),
                "all": aggregate(genuine_rows),
                "daily10": aggregate(daily10(genuine_rows)),
                "gender_calibration": gender_calibration(genuine, female_all[genuine_mask.to_numpy()], genuine_p1),
                "status": "early_read_only",
            }

        all_ci = paired_bootstrap(current_rows, gender_rows)
        accuracy_delta = aggregate(gender_rows)["top5_accuracy"] - aggregate(current_rows)["top5_accuracy"]
        winner_loss_delta = aggregate(gender_rows)["winner_log_loss"] - aggregate(current_rows)["winner_log_loss"]
        ci = all_ci["hit_top5"]["ci95"]
        if accuracy_delta > 0 and winner_loss_delta < 0 and ci[0] > 0:
            decision = "性別考慮版は主要指標で一貫して改善し、Top5差の95%区間も0を上回りました。次段階の影運用候補です。"
        else:
            decision = "現時点では本番置換条件を満たしません。改善の一貫性・統計的不確実性・日次10レース成績を優先して追加検証します。"

        result = {
            "schema": "boat-race-edge-production-gender-validation/v1",
            "model_version": prepare_forward.MODEL_VERSION,
            "bundle_sha256": prepare_forward.MODEL_SHA256,
            "design": {
                "rolling_months": ROLLING_MONTHS,
                "training_rule": "expanding window ending before each test month",
                "changed_component": "stage1 only",
                "unchanged_components": ["morning feature builder", "stage2", "stage3", "ticket counts", "daily cap"],
                "gender_features": ["candidate_female", "female_share", "mixed", "all_female", "candidate_female_x_mixed"],
                "female_roster_size": len(female_ids),
                "bootstrap_unit": "race_date",
            },
            "rolling": {
                "all": {"current": aggregate(current_rows), "gender_stage1": aggregate(gender_rows)},
                "daily10": {"current": aggregate(current_daily10), "gender_stage1": aggregate(gender_daily10)},
                "paired_bootstrap": all_ci,
                "monthly": monthly_rows,
                "gender_calibration": calibration,
            },
            "frozen_production_genuine_forward": genuine_result,
            "decision": decision,
        }
        (output_dir / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        pd.DataFrame(monthly_rows).to_csv(output_dir / "monthly.csv", index=False)
        pd.DataFrame(calibration).to_csv(output_dir / "gender-calibration.csv", index=False)
        (output_dir / "REPORT.md").write_text(markdown_report(result), encoding="utf-8")
        print("EDGE_GENDER_VALIDATION_BEGIN")
        print(json.dumps(result, ensure_ascii=False))
        print("EDGE_GENDER_VALIDATION_END")


if __name__ == "__main__":
    main()
