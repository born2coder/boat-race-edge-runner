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

The workflow runs only on a schedule or by an owner's manual dispatch. Pull
requests and forks never run the publication job.

## Public website

The `web` directory contains the Vercel-hosted Next.js site. Predictions and
results are stored in Supabase. The frozen model remains in the separate
private repository and is never shipped to Vercel or browser clients.
