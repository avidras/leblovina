# Site-scrape queue + cron drain (reliable at-scale, UI-controllable)

## Goal

Run site-scraping at any scale **reliably and hands-off**, fully in n8n, triggerable and
stoppable from the UI. Replaces the hang-prone "one giant driver execution" (looping over
thousands of clubs with a Wait/batch in a single execution hangs n8n and orphans un-killable
"running" executions). Instead: an explicit **queue** + a **scheduled cron** that drains it in
small bounded chunks — many tiny reliable executions rather than one huge one.

## Why (root cause)

A single n8n execution held open to loop over thousands of throttled iterations hangs (proven:
10-club run succeeds; 5,704-club run fires nothing and zombies). Bounded executions are fine.
So the loop must be spread across many small executions — that's what a cron-drained queue does.

## Decisions (from the design Q&A)

1. **Queue = a dedicated `scrape_queue` collection** (explicit, visible, manageable; supports
   re-enqueue / re-running already-done clubs).
2. **Controls = Pause/Resume + Clear + hard-stop**, surfaced in the UI (pause/clear) with a
   hard-stop via deactivating the cron (operator/API).

## Schema

### `scrape_queue` collection (1 club : 1 active queue row)
| field | type | notes |
|-------|------|-------|
| club | relation → clubs | required, cascadeDelete, **unique** (one active row per club; re-enqueue updates it) |
| status | select | `queued` / `done` / `error` |
| force | bool | re-scrape even if already site-scraped (for re-runs) |
| enqueued_at | date | |
| processed_at | date | set when the cron dispatches it |
| attempts | number | dispatch count |
| created / updated | autodate | |
Indexes: unique on `club`, index on `status`.

### `settings` control row
`key='scrape_drain'`, `value` (json): `{ enabled: bool, batch_size: number, ... }`.
Default `{ enabled: true, batch_size: 15 }`. The cron reads it each tick.

## Workflows (n8n)

### Enqueue — `scrape-enqueue` (webhook)
Body `{ ids?: string[], filter?: string, force?: bool }`. Creates/updates `scrape_queue` rows
(`status='queued'`) for the given club ids (or for clubs matching a PB filter, paged). Dedup by
the unique `club` index (re-enqueue resets status→queued). The UI "Scrape" button calls this with
the current Clubs filter (it enqueues; it does **not** scrape synchronously).

### Drain — `scrape-queue-drain` (Schedule Trigger / cron)
Runs every **N minutes** (default 2). The tick fires async and returns in seconds, so drain
executions never overlap each other; the only overlap that matters is the **workers** from one
tick still running when the next tick fires — handled by backpressure below.

Status flow: `queued → processing (on dispatch) → done`. A row is `done` once its club's
**`last_scraped` is newer than the row's `processed_at`** (i.e. it was actually (re)scraped
*after* we dispatched it), reconciled on a later tick. Using `last_scraped > processed_at`
(not merely "has a `scrape_note`") makes it correct for **force re-runs**, where a stale note
already exists before dispatch — otherwise such rows would be marked done instantly and
backpressure would under-count.

Each tick (a tiny, bounded, reliable execution):
1. Read `settings.scrape_drain`. If `enabled !== true` → **stop** (this is the Pause).
2. **Reconcile:** rows `status='processing'` whose club now has a `scrape_note` → `done`.
   Rows `processing` older than `stale_minutes` (default 10) with still no `scrape_note` →
   `error` (a dead worker can't deadlock the in-flight count).
3. **Backpressure:** `in_flight = count(status='processing')`. `slots = max(0, cap − in_flight)`
   (`cap` = `batch_size`, default 15 — this is the hard concurrency ceiling). If `slots == 0`
   → fire **nothing** this tick (previous chunk still running; wait).
4. Pull up to `slots` rows `status='queued'` (oldest first); if none → stop.
5. Mark them `status='processing'`, `processed_at=now`, `attempts++`, then fire the worker
   (`/webhook/site-scrape-club-v2`) for each — a small instant burst (no within-tick Wait, so
   the execution stays tiny). The dispatch-time status change means the next tick can never
   re-pick the same clubs.
Net: total concurrent workers never exceed `cap`, regardless of worker speed; if the previous
chunk hasn't drained, the tick self-throttles to few/zero. The club's own `scrape_note`/`status`
records the actual outcome; worker C-exclusion + noise filtering are unchanged.

## Stop / manage (the three levers)
- **Pause/Resume:** UI toggle writes `settings.scrape_drain.enabled`. The cron checks it at the
  start of every tick → pausing halts the drain within ≤1 tick; only the current ≤`batch_size`
  in-flight workers finish. Resume = flip it back.
- **Clear:** UI button deletes `status='queued'` rows → nothing left to drain.
- **Hard stop:** deactivate the `scrape-queue-drain` workflow (n8n API / operator) → all ticks
  stop instantly.

## UI
- Clubs page: a small **Queue** panel — counts (queued / done) + **Pause/Resume** toggle +
  **Clear queue** button. The existing "Scrape" / batch-scrape action **enqueues** the current
  filter instead of calling the giant driver.
- `pb.ts`: `ScrapeQueue` type; `settings` helper for the flag.

## Migration / deploy
- Idempotent migration creating `scrape_queue` (guard `findCollectionByNameOrId`); also created
  live via API. Seed/ensure the `settings.scrape_drain` row.
- Workflows committed under `n8n/` and PUT live (CLAUDE.md sync).

## Out of scope
- Priority ordering / per-club retries beyond `attempts` (re-enqueue handles retries).
- Completion-verification reconciliation (the club's `scrape_note` is the source of truth).

## Validation
Enqueue a small set (~30), confirm the cron drains them in chunks (bounded executions, no hang),
`scrape_pages` grow, Pause halts within one tick, Clear empties the queue. Then enqueue the full
CEV re-run (force) and let it drain hands-off.
