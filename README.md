# BOAT RACE EDGE Forward Runner

This repository contains only the thin automation layer for the BOAT RACE
EDGE public forward test. The frozen prediction model and research source are
kept in a separate private repository.

The scheduled workflow:

1. reads the public morning race card and deadline CSV files published by BoatraceCSV;
2. downloads the frozen model with a repository-scoped read-only credential;
3. locks exactly ten immutable Top3 predictions by 09:30 JST;
4. re-checks only those ten races after exhibition data arrives and publishes a display badge without changing the tickets;
5. publishes exhibition badges only before the five-minute safety cutoff;
6. never reads odds, results, or payouts while predicting or badging.

Required repository secrets:

- `EDGE_MODEL_REPOSITORY`: private repository in `owner/name` form
- `EDGE_MODEL_TOKEN`: fine-grained, read-only token limited to that repository
- `EDGE_MODEL_KEY`: strong passphrase used only to decrypt the frozen bundle
- `EDGE_SITE_INGEST_ENDPOINT`: BOAT RACE EDGE signed ingestion endpoint
- `EDGE_SITE_INGEST_SECRET`: dedicated ingestion signing secret

The workflow starts from a schedule, an owner's manual dispatch, or a change to
the runner on main. Pull requests and forks never run the publication job.

GitHub schedule events may be delayed. Each invocation therefore stays alive
for up to 345 minutes and checks every 180 seconds during the selected races'
30-minute pre-deadline windows. Outside those windows it waits without fetching.
The model is downloaded/decrypted once per invocation; source data is refreshed
on each check. A shared concurrency group keeps a single watcher active. Queued
invocations check out current main, including the latest immutable state.

The watcher stops once all selected races have been assessed or passed the
five-minute safety cutoff, and always stops by 22:00 JST. Failed source/publication
requests retry, with five consecutive failures failing the job visibly. Pending
badges expire at the cutoff; the site's receiver independently blocks late badges.
Logs report each check and which races are still waiting. This mitigates cron
delays but does not guarantee the initial job starts on time or the upstream CSV
is published in time. Missed assessments are never filled in after the cutoff.

Continuous operation is restricted to public repositories using the standard
Ubuntu runner. The job is skipped if visibility changes to private; no larger
runner or paid scheduling service is enabled.

## Public website

The `web` directory contains the Vercel-hosted Next.js site. Predictions and
results are stored in Supabase. The frozen model remains in the separate
private repository and is never shipped to Vercel or browser clients.
