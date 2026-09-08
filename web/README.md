# BOAT RACE EDGE web

The public Next.js application is deployed by Vercel from this `web` directory.

## One-time setup

1. Create a Supabase project and run every file in `supabase/migrations/` in filename order in the SQL editor:
   `20260903_initial.sql`, `20260904_morning_reassessments.sql`, then `20260906_edge_candidates.sql`.
2. Set the four values from `.env.example` in the Vercel project.
3. Import this GitHub repository in Vercel and set **Root Directory** to `web`.
4. Set the runner repository secrets `EDGE_SITE_INGEST_ENDPOINT` and `EDGE_SITE_INGEST_SECRET`.
5. Set `INGEST_ENDPOINT` and `INGEST_SECRET` to the same endpoint/secret for result synchronization.

The ingest endpoint is `/api/internal/ingest`. The service-role key is server-only and must never be exposed to browser code.
