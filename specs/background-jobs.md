# Background job activity panel

## Goal

The team triggers long-running work via fire-and-forget n8n webhooks (verify emails, sync to
Brevo, backfill, club scraping, enrichment, discovery). The trigger banner clears on refresh, so
there's no way to tell whether anything is still running or how far along it is. Add a **live,
refresh-surviving view of what's running in the background and its state**.

**Constraint:** the SPA cannot query n8n — the n8n API key lives only in n8n (secrets never reach
the app). So background workflows **write their own state into a PocketBase collection**, and the
app subscribes to it via realtime (the SPA is already superuser-authed, so it can read/subscribe).

## Decisions (agreed via questionnaire)

1. **Scope:** *all* long-running workflows report (not just Brevo/Reoon). The panel shows whatever
   reports — each workflow opts in with a few lines, so coverage grows incrementally.
2. **Surface:** a **global indicator in the header** (always visible) with a dropdown listing
   active + recently-finished jobs.
3. **Detail:** **live progress** — `processed / total` updated as each batch completes, not just a
   running/done flag.

## Schema — `job_runs` collection

Migration `pocketbase/pb_migrations/1780656300_created_job_runs.js` (idempotent). Rules `null`
(superuser-only, like every other collection — the SPA reads it post-login).

| field | type | notes |
|-------|------|-------|
| kind | text | stable workflow key, e.g. `verify-reoon`, `sync-brevo`, `brevo-backfill`, `site-scrape`, `batch-enrich`, `batch-process` |
| label | text | human label shown in the panel, e.g. "Verify emails (Reoon)" |
| status | select | `running` / `done` / `error` |
| total | number | total items (0 when unknown) |
| processed | number | items done so far (drives the progress bar) |
| message | text | latest detail / final summary / error text |
| started | date | when it began |
| finished | date | null until it ends |
| created / updated | autodate | `updated` doubles as the **heartbeat** |

Index on `status` and `updated`. A `running` row whose `updated` is older than a few minutes is
treated by the UI as **stalled** (the execution likely died) — shown distinctly, not as live.

## Workflow "report" pattern (reusable)

Every instrumented workflow, using the existing PB auth token, does three PB writes:

- **start** (once, after it knows the work size):
  `POST /api/collections/job_runs/records {kind,label,status:'running',total,processed:0,started:now}`
  → keep the returned `id` (carried on items and/or `$getWorkflowStaticData`).
- **heartbeat** (per batch): `PATCH /job_runs/{id} {processed,message}` (read-modify-write the
  running `processed`).
- **finish** (once): `PATCH /job_runs/{id} {status:'done'|'error',finished:now,processed,message}`.

Failures of these writes are swallowed (`.catch(()=>{})`) — telemetry must never break the job.

The job id is carried in `$getWorkflowStaticData('global')` across the workflow's nodes (and the
SplitInBatches loop), so the heartbeat node and the finish node find it without threading it through
items.

### Instrumented (done)
- **`verify-contacts-reoon`** — full live progress: `Pick contacts` opens the run (total = #
  contacts), `Write back` heartbeats `processed += batch` per batch, `Finish` closes it. *(Verified
  end-to-end: a run produced a `running`→`done` record with the right counts.)*
- **`sync-contacts-brevo`** — opens at `Build payload` (total = # verified), closes at `Finish`
  (processed = # pushed); empty run self-closes.
- **`brevo-backfill`** — opens at `Make offsets` (total = Brevo count), heartbeats per upsert chunk,
  closes at `Upsert into PB`.

- **`englishize-clubs`** — full live progress (`Collect` opens, `Write name_en` heartbeats per
  batch, `Finalize` closes).
- **`batch-enrich`** (Resolve N) and **`batch-process`** (Process N) — had **no PB auth** (pure
  dispatchers), so a `Config`+`PB Auth` chain was prepended; `Split ids` opens the run, a `Job tick`
  node on the loop-back heartbeats per batch, a `Job done` node on the loop's done output closes it.
- **`site-scrape-driver`** (Scrape sites) — `List clubs` opens the run (total = # clubs dispatched),
  a `Job done` node after `Fire workers` closes it (dispatch job; the live crawl progress stays in
  the scrape-queue panel).

All verified end-to-end (empty-input runs produced correct running→done records).

### Deliberately not shown as jobs
- The cron drains (`scrape-queue-drain`, `search-discover-drain`) already expose queue depth on the
  Clubs/Discovery pages; they tick continuously every couple of minutes, so they're better left to
  those panels than flooding the activity list with discrete job rows.

The panel shows **any** workflow that writes a `job_runs` row, so coverage grows incrementally with
no UI change.

## UI — global header indicator

`src/components/ActivityIndicator.tsx`, mounted in `App.tsx`'s header (left of the email/sign-out).

- A `useJobRuns` hook loads the most recent ~25 `job_runs` (by `updated` desc) and subscribes to
  the collection realtime, so it updates live and survives refresh.
- **Trigger button:** a pulse dot + count of *active* jobs (status `running` and not stalled).
  When idle, a quiet "Activity" affordance (or the last finished job briefly).
- **Dropdown:** each job as a row — label, a progress bar (`processed/total`, % ), elapsed/relative
  time, and a state chip: **running** (blue, animated), **stalled** (amber, "no update in Nm"),
  **done** (green), **error** (red, with message). Active jobs on top, then recent finished.
- Realtime means the verify run shows "4,200 / 13,000 (32%)" ticking up as batches land.

## Out of scope
- Cancelling/pausing a run from the panel (the discovery/scrape pages already own pause controls
  for their queues; this panel is read-only status).
- A full job history page (the dropdown keeps recent runs; deep history can be a later view).
- Per-item logs (the workflow execution log in n8n remains the place for that).
