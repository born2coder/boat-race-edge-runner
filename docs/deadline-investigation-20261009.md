# Official deadline drift investigation — 2026-10-09

## Confirmed findings

- The manually dispatched run `37860920985` is recording observations and entries;
  at 10:27 JST, the database contained 162 entry rows across eight races, with no
  recorded stop reason. The earlier zero-entry state was not a total ingest outage.
- Naruto 2R had missing exhibition probabilities at 08:43/08:45 and complete
  120-outcome probabilities at 08:49/08:54. Missing inputs are deliberately excluded.
- Karatsu 3R's official beforeinfo page has a blank exhibition time for lane 4;
  the official result marks lane 4 withdrawn and refunded. Exclusion is appropriate.
- The official Karatsu timetable changed: 3R 09:39 → 09:48, 4R 10:05 → 10:14,
  5R 10:34 → 10:40. The saved state retained the old values, as did the upstream
  title CSV when inspected. The observer initialized deadlines once and never
  consumed the current timetable on official preview pages.
- Karatsu 4R's final saved phase was at 09:58:51, using the old 10:05 deadline.
  The official page later had full exhibition data. This proves a schedule-following
  defect and premature exhaustion of observation phases; it does not prove the
  precise time at which the official exhibition values first appeared.

Sources (read-only inspection):

- https://www.boatrace.jp/owpc/pc/race/beforeinfo?hd=20261009&jcd=23&rno=3
- https://www.boatrace.jp/owpc/pc/race/raceresult?hd=20261009&jcd=23&rno=3
- https://www.boatrace.jp/owpc/pc/race/beforeinfo?hd=20261009&jcd=23&rno=4
- https://github.com/BoatraceCSV/boatracecsv.github.io/blob/main/data/programs/title/2026/10/09.csv
- https://github.com/born2coder/boat-race-edge-runner/actions/runs/37860920985
- `edge-data:state/edge_v2/days/2026-10-09.json`

## Fix and invariants

Reuse the existing beforeinfo GET to parse its date/venue/race-checked timetable,
independently of missing exhibition fields. Apply newer evidence to the venue's
unfinished races, preserve a change history, and overlay the official clocks into
the disposable title CSV before reloading the unchanged frozen model. Re-evaluate
the due phase after this refresh. No additional polling request is introduced.

New snapshots freeze their own close time. Existing snapshots keep their original
hash and contents; a separate boundary map preserves their original assessment
deadline when the race timetable changes. Python metrics, the Web saved-data adapter,
and fresh-payload selection respect that boundary. A revised deadline does not
revive expired observations, reopen consumed phases, or replay prior POSTs.

No model/threshold/stake changes, no backfilled predictions, no database mutations,
no paid features, no budget increases, no workflow/cron edits, and no production
deployment are part of this change. The existing ≥60-second send-completion spacing,
CPU budget, admission cap, and stop-on-error behavior remain in place.

## Verification and remaining boundaries

- Python: 89 tests, 88 passed, one existing missing-fixture skip.
- Web: 115 tests passed; TypeScript no-emit check passed.
- Production build passed after replacing the local dependency symlink with a
  local dependency copy. A non-fatal tracing warning remains in `next.config.ts`.
- Regression covers Karatsu-style +9-minute drift, missing exhibition with valid
  schedule, invalid schedule identity/time, stale response ordering, unchanged raw
  snapshots, old publication boundaries, frozen-loader title inputs, actual tick
  phase re-selection, and no revival of expired payloads.
- No live frozen-model run with the changed code has been started. Production
  activation requires separate approval and a post-activation observation check.
- Already consumed phases are deliberately not recreated, including today's missed
  Karatsu observations. A change announced only after a race's last scheduled
  observation can still be missed; this patch does not introduce continuous polling.
- The missing morning GitHub scheduled dispatch is a separate issue. This patch
  does not establish GitHub's internal dispatch cause or guarantee exact cron timing.
