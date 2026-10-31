import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts import edge_calibration as cal, market_strategy as market
from tests.test_edge_calibration import day, race


class MarketStrategyTests(unittest.TestCase):
    def vector(self, first):
        return [first] + [(1 - first) / 119] * 119

    def test_market_normalization_and_invalid_grids(self):
        odds = [20.] + [200.] * 119
        result = market.market_probabilities(odds)
        self.assertAlmostEqual(sum(result), 1)
        self.assertAlmostEqual(result[0], (1 / 20) / sum(1 / o for o in odds))
        self.assertNotAlmostEqual(result[0], 1 / 20)
        self.assertEqual(market.market_probabilities([o * 2 for o in odds]), result)
        for broken in (odds[:-1], [0] * 120, [float('nan')] * 120, [True] * 120):
            with self.assertRaises(ValueError):
                market.selections(self.vector(.1), broken)
        with self.assertRaises(ValueError):
            market.selections([.1] * 120, odds)

    def test_filters_keep_baseline_probability_ev_and_factor(self):
        p = self.vector(.1)
        odds = [19.9] + [200.] * 119
        before = copy.deepcopy((p, odds))
        choice = market.selections(p, odds)
        for arm in market.VARIANTS:
            self.assertTrue(choice[arm][0])
            self.assertFalse(any(choice[arm][1:]))  # Raw p < 1%, including blend.
        self.assertEqual((p, odds), before)
        self.assertFalse(market.selections(self.vector(.06), [20.] * 120)['marketBaseline'][0])
        self.assertTrue(market.selections(self.vector(.075), [20.] * 120)['marketBaseline'][0])
        for arm in market.selections(self.vector(.009), [1000.] * 120).values():
            self.assertFalse(arm[0])

    def test_exact_odds_and_market_gap_boundaries(self):
        for opening, expected in ((19.9, True), (20., False), (20.1, False)):
            choice = market.selections(self.vector(.1), [opening] + [200.] * 119)
            self.assertTrue(choice['marketBaseline'][0])
            self.assertEqual(choice['oddsUnder20'][0], expected)
            self.assertEqual(choice['under20Gap3'][0], expected)
        q = market.market_probabilities([120.] * 120)[0]
        for ratio, expected in ((2.999, True), (3., False), (3.001, False)):
            choice = market.selections(self.vector(q * ratio), [120.] * 120)
            self.assertEqual(choice['gapUnder3'][0], expected)

    def test_blend_is_a_separate_probability_at_same_coefficient(self):
        p, odds = self.vector(.015), [120.] * 120
        q = market.market_probabilities(odds)[0]
        choice = market.selections(p, odds)
        self.assertTrue(choice['marketBaseline'][0])
        self.assertEqual(choice['blend50'][0], ((p[0] + q) / 2) * .8 * odds[0] >= 1.2)
        # Raising accuracy is not assumed to raise return or preserve purchases.
        self.assertFalse(choice['blend50'][0])

    def test_snapshot_records_without_calibration_training_or_final_grid(self):
        report = cal.build_report([], '2026-10-01', 'model-a')
        snapshot = race(day())['snapshots']['t10']
        shadow = cal.shadow_snapshot(snapshot, report)
        self.assertFalse(report['phases']['t10']['probabilityTrainReady'])
        self.assertEqual(shadow['marketExperimentId'], market.EXPERIMENT)
        self.assertEqual(shadow['marketDecisions'], market.selections(snapshot['exhibition'], snapshot['odds']))
        self.assertFalse(shadow['purchaseEnabled'])
        for version in ('edge-calibration-v1', 'edge-calibration-v2', 'edge-calibration-v3'):
            legacy = dict(report, version=version)
            self.assertNotIn('marketDecisions', cal.shadow_snapshot(snapshot, legacy))
        self.assertEqual(report['marketRules'], market.RULES)

    def saved(self):
        d = day()
        r = race(d)
        r.pop('final')
        r['snapshots']['t10']['odds'] = [19.9] + [200.] * 119
        r['snapshots']['t10']['exhibition'] = self.vector(.1)
        report = cal.build_report([], d['date'], 'model-a')
        shadow = cal.shadow_snapshot(r['snapshots']['t10'], report)
        shadow['recordedAt'] = d['date'] + 'T00:50:01Z'
        r['calibration_shadow'] = {'snapshot-1': shadow}
        return d, shadow

    def scored(self, d):
        rows, _ = cal.examples([d], '2026-10-12', 'model-a')
        return market.forward(rows)['t10']

    def test_forward_uses_recorded_decisions_actual_payout_and_no_replay(self):
        d, shadow = self.saved()
        result = self.scored(d)
        self.assertEqual(result['recordedRaces'], 1)
        for arm in result['policies'].values():
            self.assertEqual((arm['tickets'], arm['payout'], arm['roi']), (1, 5000, 50))
        # Never substitute recomputed decisions for the saved decision.
        for arm in market.VARIANTS:
            shadow['marketDecisions'][arm][0] = False
        self.assertEqual(self.scored(d)['policies']['marketBaseline']['tickets'], 0)
        self.assertIsNone(self.scored(d)['policies']['marketBaseline']['roi'])
        shadow.pop('marketExperimentId')
        self.assertEqual(self.scored(d)['recordedRaces'], 0)

    def test_late_incomplete_wrong_experiment_unacknowledged_records_rejected(self):
        def missing_arm(d, s): s['marketDecisions'].pop('blend50')
        def wrong_length(d, s): s['marketDecisions']['blend50'].pop()
        def wrong_type(d, s): s['marketDecisions']['blend50'][0] = 1
        def different_support(d, s): s['marketDecisions']['blend50'][0] = None
        for mutate in (missing_arm, wrong_length, wrong_type, different_support,
                       lambda d, s: s.update(marketExperimentId='old'),
                       lambda d, s: s.update(recordedAt='2026-10-01T01:00:00Z'),
                       lambda d, s: s.update(recordedAt='2026-10-01T00:50:03Z'),
                       lambda d, s: d.update(forward_observations_sent=[]),
                       lambda d, s: d.update(forward_observations_ignored=['snapshot-1'])):
            d, shadow = self.saved()
            mutate(d, shadow)
            self.assertEqual(self.scored(d)['recordedRaces'], 0)

    def test_history_never_becomes_forward_and_empty_is_unavailable(self):
        report = cal.build_report([day()], '2026-10-12', 'model-a')
        self.assertEqual(report['phases']['t10']['marketComparison']['marketBaseline']['payout'], 5000)
        for phase in report['marketForwardComparison'].values():
            self.assertEqual(phase['recordedRaces'], 0)
            self.assertIsNone(phase['policies']['marketBaseline']['roi'])
            self.assertEqual(phase['policies']['marketBaseline']['supportedTickets'], 0)

    def test_v4_never_overwrites_v3_archive_and_is_frozen(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / 'calibration/edge-calibration-v3/2026-10-12.json'
            old.parent.mkdir(parents=True)
            old.write_text('{"version":"edge-calibration-v3"}')
            first = cal.daily_report(root, '2026-10-12', 'model-a')
            self.assertEqual(first, cal.daily_report(root, '2026-10-12', 'model-a'))
            self.assertEqual(old.read_text(), '{"version":"edge-calibration-v3"}')
            self.assertEqual(json.loads((root / 'calibration/latest.json').read_text())['version'], 'edge-calibration-v4')


if __name__ == '__main__':
    unittest.main()
