"""Fixed shadow experiment; no purchase execution or model changes."""
import math
from collections import defaultdict

EXPERIMENT = "calibration-strategy-20261026-v1"
FACTORIAL_EXPERIMENT = "calibration-factorial-20261031-v1"
FACTORIAL_VARIANTS = ("raw080", "raw100", "calibrated080", "calibrated100")
BOUNDS = (.005, .01, .02, .05, .1, .2, 1.01)
VARIANTS = ("baseline", "probability", "adjusted")
TIMES = ("t15", "t10", "t5")


def fit_probability(rows):
    # Fixed smoothing, fitted on training dates only. Pool adjacent violations
    # so interpolation cannot reverse the original model's ranking.
    bins = [[0, 0., 0] for _ in BOUNDS]
    for row in rows:
        for i, p in enumerate(row["p"]):
            b = next(j for j, upper in enumerate(BOUNDS) if p < upper)
            bins[b][0] += 1
            bins[b][1] += p
            bins[b][2] += i == row["winner"]
    points = []
    for n, total, hits in bins:
        if n:
            x = total / n
            points.append({"x": x, "y": (hits + 200 * x) / (n + 200), "weight": n + 200})
    blocks = []
    for i, point in enumerate(points):
        blocks.append([i, i, point["y"] * point["weight"], point["weight"]])
        while len(blocks) > 1 and blocks[-2][2] / blocks[-2][3] > blocks[-1][2] / blocks[-1][3]:
            right = blocks.pop()
            left = blocks.pop()
            blocks.append([left[0], right[1], left[2] + right[2], left[3] + right[3]])
    for first, last, total, weight in blocks:
        for i in range(first, last + 1):
            points[i]["y"] = total / weight
    return points


def calibrate(probabilities, points):
    if not points:
        return list(probabilities)
    # Anchor endpoints; interpolate smoothly, then normalize within each race.
    knots = [(0., 0.)] + [(q["x"], q["y"]) for q in points if 0 < q["x"] < 1] + [(1., 1.)]
    values = []
    for p in probabilities:
        for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
            if p <= x1:
                values.append(max(1e-15, y0 + (y1 - y0) * (p - x0) / (x1 - x0)))
                break
    total = sum(values)
    return [p / total for p in values]


def selections(raw, corrected, odds, lower, ready=True, cap=None):
    output = {name: [] for name in VARIANTS}
    for p, adjusted, opening, closing in zip(raw, corrected, odds, lower):
        # Eligibility is fixed to the production raw-p minimum for all arms.
        eligible = p >= .01 and (cap is None or opening < cap)
        common = ready and closing is not None
        for name, ev in (("baseline", p * .8 * opening),
                         ("probability", adjusted * opening),
                         ("adjusted", adjusted * closing if closing is not None else None)):
            output[name].append(bool(eligible and ev >= 1.2) if common else None)
    return output


def factorial_selections(raw, corrected, odds, ready=True):
    """2 x 2 comparison at the same observed odds; no closing-odds dependency."""
    output = {name: [] for name in FACTORIAL_VARIANTS}
    for p, calibrated, opening in zip(raw, corrected, odds):
        eligible = p >= .01
        for name, probability, factor in (("raw080", p, .8), ("raw100", p, 1.),
                                          ("calibrated080", calibrated, .8), ("calibrated100", calibrated, 1.)):
            output[name].append(bool(eligible and probability * factor * opening >= 1.2) if ready else None)
    return output


def summarize(rows, decisions, cap=None, variants=VARIANTS):
    output = {}
    for name in variants:
        daily = defaultdict(lambda: {"tickets": 0, "hits": 0, "stake": 0, "payout": 0})
        wins, supported, unsupported, races = [], 0, 0, set()
        for row, choices in zip(rows, decisions):
            values = choices[name]
            for i, choice in enumerate(values):
                if cap is not None and row["odds"][i] >= cap:
                    continue
                if choice is None:
                    unsupported += 1
                    continue
                supported += 1
                races.add(row["race_id"])
                if not choice:
                    continue
                d = daily[row["date"]]
                d["tickets"] += 1
                d["stake"] += 100
                if i == row["winner"]:
                    d["hits"] += 1
                    d["payout"] += row["payout"]
                    wins.append(row["payout"])
        totals = {k: sum(d[k] for d in daily.values()) for k in ("tickets", "hits", "stake", "payout")}
        cumulative = peak = drawdown = 0
        days = []
        for date, d in sorted(daily.items()):
            net = d["payout"] - d["stake"]
            cumulative += net
            peak = max(peak, cumulative)
            drawdown = max(drawdown, peak - cumulative)
            days.append({"date": date, **d, "net": net, "roi": d["payout"] / d["stake"]})
        output[name] = {**totals, "roi": totals["payout"] / totals["stake"] if totals["stake"] else None,
                        "net": totals["payout"] - totals["stake"], "daily": days,
                        "supportedTickets": supported, "unsupportedTickets": unsupported,
                        "evaluatedRaces": len(races), "maxDailyDrawdown": drawdown,
                        "top5PayoutShare": sum(sorted(wins, reverse=True)[:5]) / totals["payout"] if totals["payout"] else None}
    return output


def frozen_forward(rows, variants=VARIANTS, experiment=EXPERIMENT,
                   experiment_key="experimentId", decisions_key="decisions"):
    """Score only acknowledged pre-close choices actually recorded by v2."""
    output = {}
    for phase in ("t20", *TIMES):
        selected, choices = [], []
        for row in rows:
            shadow = row.get("shadow") or {}
            if row["phase"] != phase or shadow.get(experiment_key) != experiment or not row.get("shadow_valid"):
                continue
            decision = shadow.get(decisions_key)
            if not isinstance(decision, dict) or any(
                not isinstance(decision.get(k), list) or len(decision[k]) != 120
                or any(v is not None and not isinstance(v, bool) for v in decision[k]) for k in variants):
                continue
            # Every arm must be evaluated on exactly the same supported set.
            if any(len({decision[k][i] is None for k in variants}) != 1 for i in range(120)):
                continue
            selected.append(row)
            choices.append(decision)
        output[phase] = {"all": summarize(selected, choices, variants=variants),
                         "under20": summarize(selected, choices, 20, variants=variants),
                         "recordedRaces": len(selected)}
    return output


def factorial_forward(rows):
    return frozen_forward(rows, FACTORIAL_VARIANTS, FACTORIAL_EXPERIMENT,
                          "factorialExperimentId", "factorialDecisions")
