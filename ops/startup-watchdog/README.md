# BOAT EDGE startup watchdog

Cloudflare scheduled Worker for the public born2coder/boat-race-edge-runner repository.
Deployment starts disabled, with no cron, until GITHUB_ACTIONS_TOKEN is installed
as a Cloudflare encrypted Secret and validation is complete.

Intended cron: */15 * * * *. The code acts only 07:30–23:59 JST.
It checks the persistent stop record, workflow status and recent runs, permits
only successful previous jobs, waits 15 minutes after completion and permits
at most four workflow_dispatch starts per JST day (manual starts included).
Existing GitHub workflow concurrency, 315-minute runtime, CPU, request and
observation limits remain unchanged. It does not erase stops or retry failed,
cancelled, skipped, disabled, ambiguous or unauthorized execution.
HTTP requests to the Worker cannot start jobs. No public endpoint is required.

Run tests: node --test worker.test.mjs
The fine-grained PAT requires only this repository, Actions read/write and
required Metadata read access. Store no token value in source, logs or chat.
The issued token expires 2026-11-10; rotate before that date. This expiry must
be addressed operationally before describing the setup as permanent.

The existing Invalid odds persistent stop remains unresolved by this watchdog.
