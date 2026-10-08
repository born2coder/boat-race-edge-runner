# Bounded prospective research

Only `research-forward.yml` should be enabled for ongoing new four-page research.
The EDGE, HIT, results-repair, type-G, training and receipt-recovery jobs require
`EDGE_LEGACY_AUTOMATION_ENABLED=1`; leave this variable absent or `0`.

Activation requires all three controls:

1. Production Vercel config `RESEARCH_FOUR_PAGE_RECORDING=1`.
2. Repository variable `EDGE_AUTOMATION_ENABLED=1` and GitHub Actions enabled.
3. `four_page_recording_control.recording_enabled=true` with a new, current
   `approved_since`. Never backdate approval or replay old snapshots.

Observe one tick (`workflow_dispatch`, `once=true`) before a sustained run
(`once=false`). Scheduled starts are 07:17, 12:17, 17:17 JST. Runs serialize and
exit at 22:00. A schedule can be delayed by GitHub; this is not continuous uptime.
Inference and official collection run on a public GitHub runner. Vercel receives
at most one bounded batch per minute, or an idle heartbeat every five minutes.
No display polling, automatic deployment, all-history research API, or final-odds
collection is restarted. The previous day's unresolved recorded cohort alone can
be settled without forecasting or replaying old observations.

The signed API accepts at most 24 full-120 snapshots, 24 results and 512,000 bytes.
It has a 30-second runtime limit and durable single-request admission.
Measured **process CPU** of 60,000 ms or 1,000 accepted requests in one JST day
disables recording persistently. Process CPU can include concurrent requests;
it is a conservative operational signal, not Vercel's exact billed CPU. Auth,
reads, nonce handling, cold starts, completion overhead and other routes are not
fully accounted for by this ledger. This is not a guarantee against team limits.

An API processing error disables recording immediately. An unfinished admitted
request stops the next admission. Runner failures save `forward-paused.json` on
`edge-data` and never self-dispatch. If GitHub itself cannot persist the stop,
the next scheduled runner can start; API admission still enforces durable limits.
Restoration after a failure is an explicit investigation and fresh approval, not
an automatic next-day reset. Retain the historical budget and stop audit data.

Read-only verification:

```sql
select rule_version,recording_enabled,approved_since from public.four_page_recording_control;
select race_date,requests,cpu_ms,lease_id,stopped_reason from public.four_page_flow_budget order by race_date desc limit 7;
select race_date,count(*) from public.four_page_observations group by race_date order by race_date desc limit 7;
select race_date,count(*) from public.four_page_entries group by race_date order by race_date desc limit 7;
```

Emergency stop: set `recording_enabled=false`, set `EDGE_AUTOMATION_ENABLED=0`,
and cancel the active new workflow. Do not re-enable legacy recovery jobs.

Migration: `web/supabase/migrations/20261008021439_bounded_research_flow.sql`.
It is additive, service-only, RLS protected, and never activates recording.
