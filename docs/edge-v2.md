# EDGE full120 v2

Prospective observation version: `edge-full120-v2`. The frozen morning and exhibition models are unchanged; extraction now evaluates their entire 120-combination distributions. Each inference checks probability mass and agreement with the original top eight. HIT and legacy EDGE records stay separate.

## Fixed evaluation protocol

- Odds windows: T20 = 25–17 minutes before closing; T15 = 17–13; T10 = 12–8. Actual request completion and official update times are retained. Odds older than five minutes are rejected. Labels are windows, not exact scheduled seconds.
- All 120 odds and both available probability vectors are stored once per race/window. Exhibition requires the original source safety metadata and source readiness no later than inference. No retrospective forecasts are published.
- Thresholds 150/175/200/300 percent run concurrently, at 100 yen per ticket. Full120, top8 and rank9–120 subsets are separate comparisons. They are alternative strategies, not stakes to add together.
- Paired morning/exhibition comparisons use identical race/window/odds snapshots where both distributions are available. Multiclass log loss (probability floor 1e-15) and summed multiclass Brier score evaluate all combinations, independent of ticket threshold. Refund/cancelled races are omitted from probability scores.
- Pending results are excluded from return rates. Voided tickets are excluded from both stake and returned principal. Daily aggregation sums stakes and payouts, never daily percentages.
- A production receipt must return the snapshot ID before closing. It is a conservative upper bound on public availability, not an exact first-display timestamp. Unconfirmed/late records remain visible but do not enter prospective performance.
- Final grids require an official result and agreement between winning odds and official payout. Missing grids remain missing. Nonwinning final odds cannot be inferred from the winning payout alone.

## Operation

`scripts/watch_edge_v2.py` is the sole ledger writer. It prioritizes prospective snapshots, then bounded settlement and one older pending day per loop. It retains first snapshots and first receipts across retries. It queues its successor before the runner lifetime ends; hourly cron and the results workflow supply independent recovery. GitHub scheduling can still be delayed: heartbeat age and missed windows are explicitly displayed, not interpreted as zero candidates.

Public ledger: `state/edge_v2/days`, `summaries`, `index.json`. `/edge` reads this ledger. `/edge/legacy` preserves the previous history. Read-only `/api/edge/v2/receipt` uses the same ledger path; `/api/edge/v2/results` exposes existing public official results. No database migration is required.

## Acceptance and next decision

The encrypted production bundle passed an isolated contract check on 12 morning and 11 exhibition races: all120 distributions, original top8 agreement. This is interface validation, not a historical profitability backtest.

First verify live coverage, publication delay, exhibition availability and closing-grid completeness. Then assess paired daily differences, odds retention and rank9–120 contribution across multiple weeks and venues. Report race/day sample sizes and race/day-block uncertainty before choosing a threshold or recalibrating probabilities. The previous seven days and top8-only records cannot reconstruct missing prospective120 snapshots. No profitability improvement is claimed at rollout.

Validation: Python unittest suite, Next.js production build and web tests. Full live T20/T15/T10 acceptance requires the next racing day after rollout.

## 2026-09-14 stabilization

- The upstream preview CSV is collected around T10, after our first T10 snapshot at roughly T12. Fetch official beforeinfo pages directly before inference; check race/date and all six registered racers. Store original parsed rows, source URL/hash and actual receipt time. Missing fields stay unavailable; existing snapshots are never retrospectively completed.
- Official result pages are polled in bounded batches. The official daily K archive is reconciled every 15 minutes and repairs the existing site result table through signed ingestion. K0/F/L refunds and races with fewer than three remaining starters are explicitly handled. Night-time settlement drains bounded final-grid batches.
- Runtime records migrate to `edge-data`; that branch disables Vercel deployments. The application on main stays deployable. The writer mirrors data to main until the deployed receipt endpoint positively acknowledges `storage_branch: edge-data`. This preserves the old production read path while a Vercel quota restriction delays deployment. Until acknowledgement, the deployment-volume reduction is not yet active.
- Page and receipt reads use the same minute cache key, avoiding the upstream five-minute cached URL. This requires the new frontend deployment; deployment failure must not be reported as a completed migration.
- Acceptance on 2026-09-14: independently recovered 168 results including one trifecta cancellation; flat100 ROI reproduces 39.4011/139.9849/183.2374 percent for T20/T15/T10 at150. The official preview parser reached the real frozen exhibition model and returned120 probabilities in an offline fixture. This is not evidence of live exhibition publication. That final acceptance requires a subsequent live racing window.
