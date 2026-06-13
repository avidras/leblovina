# Brevo sync → two-way reconcile (push + capture blocklist + remove non-eligible)

> Extends `sync-contacts-brevo`. The push half is unchanged (`specs/brevo-reoon-integration.md`
> §2). This adds the **remove half** so Brevo list 12 ends each run as *exactly* the sendable
> set, and captures unsubscribes/spam from Brevo back into our DB.

## Problem

The sync was **add-only**: it upserts eligible contacts into list 12 but never removes anyone.
So a contact that *was* eligible and later became ineligible — unsubscribed/marked-spam
(`blocklisted`), went `undeliverable` on re-verify, or was deleted — stays in the Brevo list
forever. The team sends direct mail to list 12, so it must reflect the current sendable set, and
new unsubscribes from a send must be captured so they're never targeted again.

## Decisions (agreed via questionnaire)

1. **Two-way reconcile, not add-only.** Each sync makes list 12 == the eligible set: push
   eligible (add/update) **and remove** every list member that's no longer eligible.
2. **Blocklisted contacts are removed from the list.** Brevo suppresses blocklisted
   (unsubscribed/spam) contacts **account-wide** — it never emails them regardless of list
   membership, and the flag lives on the *contact*, not the list. So removing them from list 12
   loses no unsubscribe history and changes no deliverability; it just keeps the list == sendable
   set. They won't be re-added (the gate excludes `blocklisted`).
3. **Capture blocklist on sync.** While fetching list members we already get each contact's
   `emailBlacklisted`; members Brevo flags are marked `blocklisted=true` in our DB, so the next
   sync drops them from eligible (and the whole-account `brevo-backfill` remains for a broader
   refresh).
4. **Async.** The webhook responds immediately (`responseNode`) and runs in the background; the
   `job_runs` panel shows progress. (Reconcile is longer than the old add-only push.)

## Eligibility (the gate, unchanged)

`(verification_status='verified' || 'catch_all' || 'mx_only') && blocklisted != true`
(+ any incoming `filter`). See `specs/brevo-reoon-integration.md` §2.

## Workflow shape

```
Webhook → Respond(immediate) → Config → PB Auth → Attrs → Ensure attr → Build payload
  → Brevo import (push eligible, per 1k chunk)
  → After push → Count → Make offsets → List page (paginate list 12 members)
  → Reconcile → Remove from list → Finish
```

- **Build payload** (unchanged push + 2 additions): builds eligible `rows`, opens the `job_runs`
  row, emits 1k-chunk import items. **New:** stores `sd.eligible = { emailLower: 1 }` for every
  eligible row and `sd.syncListId = listId` (for the reconcile half).
- **Brevo import** — `POST /v3/contacts/import` per chunk (add/update into list 12). Unchanged.
- **After push** (Code, runs once) — emits one item `{ path: '/v3/contacts/lists/<id>/contacts' }`
  to drive the member fetch.
- **Count → Make offsets → List page** — mirror of `brevo-backfill`'s pagination: `Count` gets
  the list's contact `count`; `Make offsets` emits `offset` items (page size **500** — the list
  endpoint's max); `List page` GETs `…/contacts?limit=500&offset=N` per page. Each page item
  carries `contacts[]` with `email` + `emailBlacklisted`.
- **Reconcile** (Code, runs once over all pages):
  1. Build the member map `emailLower → emailBlacklisted` from all pages.
  2. **Capture blocklist:** for each member Brevo flags `emailBlacklisted`, find our contact by
     email and set `blocklisted=true` if not already (concurrency 25).
  3. **Compute removals:** `toRemove = members whose email ∉ sd.eligible` (covers blocklisted,
     newly-undeliverable, deleted, anything that fell out of the gate).
  4. Emit `{ listId, emails[] }` batches of ≤150 (Brevo remove limit); if none, emit one empty
     batch so `Finish` still runs. Stash counts in `sd` (`syncRemoved`, `syncCaptured`,
     `syncMembers`).
- **Remove from list** — `POST /v3/contacts/lists/<id>/contacts/remove { emails }` per batch,
  `onError: continueRegularOutput` (an empty batch 400s harmlessly; a real failure just leaves
  that contact to be retried next sync).
- **Finish** (Code, runs once) — `settings.brevo.last_sync = now`; close the `job_runs` row with
  `Pushed N · removed M · blocklist-captured K`.

## Credentials
- PB: `httpCustomAuth` (`hzdBwrAqrPZjDmME`). Brevo: `httpHeaderAuth` `Brevo (api)`
  (`oIxwF9CXYhqzmPEu`, header `api-key`) on all Brevo HTTP nodes. Committed export carries
  `REPLACE_BREVO_CRED`, swapped at PUT time.

## Notes / limits
- Reconcile only sees **list-12 members** for blocklist capture (efficient, matches the send
  audience). The whole-account refresh stays in `brevo-backfill` (`Import / refresh from Brevo`).
- `sd.eligible` holds ~15k lowercased emails in the workflow's global staticData (~1 MB,
  overwritten each run). Acceptable for this manual, serial job (same single-run assumption as
  the `job_runs` id).
- Removals are usually tiny (only what dropped out since the last sync), so the remove pass is
  cheap; the member fetch (~30 pages) dominates.

## Out of scope
- Deleting contacts from Brevo entirely (we only remove list membership; deletes stay in the
  PB delete-hook path).
- Reconciling the 6 region lists (this owns only list 12, the app's "App – verified leads").
