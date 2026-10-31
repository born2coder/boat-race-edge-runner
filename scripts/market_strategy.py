"""Predeclared market-aware shadow policies. Never writes the purchase ledger."""
import math

from scripts import calibration_strategy as strategy

EXPERIMENT = "market-strategy-20261031-v1"
VARIANTS = ("marketBaseline", "oddsUnder20", "gapUnder3", "under20Gap3", "blend50")
RULES = {"minimumRawProbability": .01, "coefficient": .8, "minimumEV": 1.2,
         "oddsExclusiveUpper": 20, "gapExclusiveUpper": 3, "modelWeight": .5,
         "stakeYen": 100, "marketProbability": "(1/observedOdds)/sum(1/observedOdds)",
         "selection": "all qualifying combinations; no ranking cap", "mode": "shadow"}


def market_probabilities(odds):
    """Remove the common overround from a complete simultaneous 120-way grid."""
    if (len(odds) != 120 or any(isinstance(o, bool) or not isinstance(o, (int, float))
                              or not math.isfinite(o) or not 0 < o <= 100000 for o in odds)):
        raise ValueError("Complete valid observed odds are required")
    inverse = [1 / o for o in odds]
    total = sum(inverse)
    return [p / total for p in inverse]


def selections(raw, odds):
    market = market_probabilities(odds)
    if (len(raw) != 120 or any(isinstance(p, bool) or not isinstance(p, (int, float))
                             or not math.isfinite(p) or not 0 <= p <= 1 for p in raw)
            or abs(sum(raw) - 1) > .001):
        raise ValueError("Complete valid model probabilities are required")
    output = {name: [] for name in VARIANTS}
    for p, q, opening in zip(raw, market, odds):
        eligible = p >= RULES["minimumRawProbability"]
        baseline = eligible and p * RULES["coefficient"] * opening >= RULES["minimumEV"]
        low_odds = opening < RULES["oddsExclusiveUpper"]
        moderate_gap = p / q < RULES["gapExclusiveUpper"]
        blend = RULES["modelWeight"] * p + (1 - RULES["modelWeight"]) * q
        decisions = (baseline, baseline and low_odds, baseline and moderate_gap,
                     baseline and low_odds and moderate_gap,
                     eligible and blend * RULES["coefficient"] * opening >= RULES["minimumEV"])
        for name, choice in zip(VARIANTS, decisions):
            output[name].append(bool(choice))
    return output


def historical(rows):
    return strategy.summarize(rows, [selections(r["p"], r["odds"]) for r in rows], variants=VARIANTS)


def forward(rows):
    # Validate immutable IDs, 120 decisions per arm, shared support, pre-close ACK.
    groups = strategy.frozen_forward(rows, VARIANTS, EXPERIMENT, "marketExperimentId", "marketDecisions")
    return {phase: {"policies": group["all"], "recordedRaces": group["recordedRaces"]}
            for phase, group in groups.items()}
