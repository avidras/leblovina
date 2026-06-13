# Brevo sync + Reoon email verification

> Two related features in one spec because they're coupled by a single rule: **only
> proven-deliverable emails reach Brevo.** Reoon writes the deliverability state onto each
> contact; the Brevo push reads it as its gate. Build Reoon first (it produces the gate
> signal), then Brevo.

## Goal

Make our `contacts` collection the **single source of truth** for the newsletter audience, and
keep Brevo (the newsletter sender) a mirror of it:

1. **Reoon** — verify every contact email's deliverability and store the result on the contact
   (`verification_status` + `verified_at`). Manual, batch, credit-aware.
2. **Brevo (push)** — send our **proven-deliverable** contacts into a Brevo list, with their
   attributes, on demand. Re-runs update existing Brevo contacts (upsert).
3. **Brevo (delete sync)** — deleting a contact in our app hard-deletes it in Brevo, so the two
   never drift.
4. **Brevo (backfill)** — a one-time import of the contacts that already exist in Brevo into our
   DB as `source_type='brevo'` (email only, no club), so nothing is stranded outside our system.

Outreach still happens in Brevo; verification still happens in an external paid verifier (now
named: **Reoon**). Both integrations live in **n8n** (secrets stay there); the app triggers
them via webhooks and a PocketBase delete hook, exactly like every other pipeline here.

## Decisions (agreed via questionnaire)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Reoon verify trigger | **Manual button** | Reoon bills per email; the team decides when to spend credits. Auto-on-new would burn credits continuously as scraping adds thousands of contacts. Skips recently-verified rows (domain rule #3). |
| 2 | Brevo deliverability gate | **Deliverable** = `verification_status` ∈ {`verified`, `catch_all`, `mx_only`} | "Don't send non-deliverable emails." `verified`, `catch_all` (domain accepts mail), and `mx_only` ("Unable to verify" — domain accepts mail + valid syntax, but the provider blocks SMTP probing, e.g. `wp.pl`/`t-online.de`; the addresses are almost all real, so we send them rather than discard real leads) all go to Brevo. `unknown` (no MX / malformed), `unverified`, `undeliverable` are held back. Protects sender reputation. |
| 3 | Brevo push trigger | **Manual button** | Same as verification — explicit, controlled. Deletes still propagate automatically (see #4) so we never email a removed contact. |
| 4 | Delete semantics | **Hard-delete in Brevo**, propagated **automatically** via a PocketBase delete hook | One source of truth: gone here = gone there. The hook catches deletes from *anywhere* (UI, PB admin, API), not just a UI button. |
| 5 | Brevo attributes | **NAME, CLUB, COUNTRY, QUALITY** (besides EMAIL) | Enough for personalization + geographic/quality segmentation of campaigns. |
| 6 | Backfill provenance | `source_type='brevo'`, **no club**, email only | Brevo has no club data; import as bare emails so we hold one row per address. Idempotent on the `email` unique index — re-running creates nothing new. |

> **Supersedes:** an earlier draft answer set the Brevo scope to "all contacts." The Reoon gate
> (#2) replaces it — the push filter is
> `(verification_status='verified' || verification_status='catch_all' || verification_status='mx_only') && blocklisted!=true`.
> (`catch_all` and later `mx_only` were added: both mean the domain accepts mail, so we treat them
> as deliverable rather than discard real leads.)

## Schema changes

One **idempotent** migration (`pocketbase/pb_migrations/<ts>_brevo_reoon.js`). No new
collection — we extend `contacts` and seed two `settings` rows.

### `contacts`
- **`club`: `required: false`.** Backfilled Brevo contacts have no club. (Relation stays
  `maxSelect:1`, `cascadeDelete:true` — a club delete still cascades to its contacts, which is
  desired; those cascade-deletes also fire the Brevo delete hook.)
- **`source_type`: add value `"brevo"`** → `["directory","club_site","manual","brevo"]`.
- `verification_status` is **unchanged** — it already has every state Reoon needs
  (`unverified | mx_only | verified | catch_all | undeliverable | unknown`). `verified_at`
  already exists.
- No `brevo_id` / `brevo_synced_at` field: Brevo identifies contacts by **email** (which we
  hold), so upsert and delete need no extra key, and per-contact sync stamps would mean N
  writes per push. Sync state is tracked once on `settings.brevo.last_sync` instead.

### `settings` seeds (idempotent — skip if the key exists)
- **`brevo`** = `{ list_id: null, last_sync: null }` — `list_id` is the Brevo contact **list**
  the newsletter audience lives in (push target + default backfill source). Set it once via the
  PB admin (or a future settings UI) to your newsletter list's numeric id.
- **`reoon`** = `{ mode: "power", reverify_days: 90, last_run: null }` — `mode` is Reoon's
  verification depth (`power` = full SMTP check, most accurate; `quick` = cheaper/faster);
  `reverify_days` is the skip-window for domain rule #3 (don't re-verify anything checked within
  N days).

### `pb.ts` / labels
- `ContactSourceType` gains `'brevo'`; `CONTACT_SOURCE_TYPES` includes it.
- `SOURCE_TYPE_LABELS.brevo = 'Brevo'` in `src/lib/labels.ts`.

## Reoon → `verification_status` mapping

Reoon's `power`-mode bulk result carries a per-email `status` (and an
`overall_result`/`is_deliverable`). Map to our enum:

| Reoon status | our `verification_status` | goes to Brevo? |
|--------------|---------------------------|----------------|
| `safe` (deliverable) | `verified` | **yes** |
| `role_account` (deliverable role addr, e.g. info@) | `verified` | yes |
| `catch_all` | `catch_all` | **yes** (gate #2 — domain accepts mail) |
| `unknown` **+ `mx_accepts_mail` + valid syntax** | `mx_only` ("Unable to verify") | **yes** (gate #2 — domain accepts mail, provider blocks SMTP probing) |
| `unknown` (no MX / malformed) | `unknown` | no |
| `invalid` / `disabled` / `disposable` / `spamtrap` / `inbox_full` | `undeliverable` | no |

Every verified row also sets `verified_at = now`. We never invent or alter the email itself
(domain rule #1) — verification only writes status/timestamp.

## Workflows (n8n)

All four follow the house pattern: **Webhook → Config (`pbUrl`) → PB Auth → Code/HTTP**. PB is
reached from Code nodes via the auth token; **Brevo and Reoon are called from credentialed HTTP
Request nodes** (Code nodes can't use n8n credentials — same constraint as Serper/Anthropic).

Credentials (created once in n8n; **never committed**):
- **`Brevo (api)`** — generic `httpHeaderAuth`, header `api-key: <BREVO_API_KEY>`. Base
  `https://api.brevo.com`.
- **`Reoon (bulk)`** — generic `httpCustomAuth` injecting `key` into both the request **body**
  (bulk-create needs it there) and **query** (bulk-poll reads it there). Base
  `https://emailverifier.reoon.com`. *(Replaced the old `Reoon (api)` query-auth credential when
  we moved off the real-time endpoint.)*

### 1. `verify-contacts-reoon` (webhook `verify-contacts-reoon`)
Manual "Verify emails" button. Body `{ ids?, filter?, force? }` (omit → all not-recently-verified).
**Async** — responds `{started:true}` immediately and runs in the background.

**Now uses Reoon's BULK API** (submit one task → poll → write back), not the per-email
real-time endpoint. The full design, the rate-limit/timeout bug it fixes, and the node graph
live in **`specs/reoon-bulk-verification.md`**. In short:
1. **Webhook (`responseMode: responseNode`) → Respond** `{started:true}` immediately.
2. **PB Auth → Pick contacts** — same target resolution (`ids` / `filter` / all), dedup on
   email, drop `blocklisted`, skip SETTLED (`verified`/`undeliverable`/`catch_all`) verified
   within `reverify_days` unless `force`; `unknown`/`unverified` always re-checked. Opens the
   `job_runs` row and emits one item `{ name, emails[] }`.
3. **Create task → Wait (20s) → Get result → Poll tick → IF done?** — submit the whole list as
   one bulk task (≤50k, power mode), then poll on a Wait loop, heartbeating
   `job_runs.processed = count_checked` until `status==='completed'`.
4. **Write back** — map each per-email `results[email].status` (table above) → contact and PATCH
   `{verification_status, verified_at}` in concurrency-25 chunks.
5. **Finish** — stamp `settings.reoon.last_run`, close the `job_runs` row.

> The old real-time flow fired per-email with no throttle/retry and got **429-rate-limited and
> 30s-timed-out**, silently recording those failures as `unknown` — so re-runs churned the same
> stuck addresses forever. Bulk removes that class of failure (server-side, no per-request limit).

Progress is visible live (PB realtime + the Activity panel). Scope a run with the page filter to
limit credits/time; `force` re-verifies inside the `reverify_days` window. Verification uses
Reoon's **bulk-task API** — see `specs/reoon-bulk-verification.md`.

### 2. `sync-contacts-brevo` (webhook `sync-contacts-brevo`)
Manual "Reconcile Brevo list" button. Body `{}` (all eligible) or `{ filter }`. **Two-way
reconcile** — pushes eligible, captures unsubscribes/spam from Brevo, and removes from the list
anyone no longer eligible, so list 12 ends == the sendable set. Full design in
**`specs/brevo-sync-reconcile.md`**. In short:
1. **Build payload**: page eligible `contacts`
   (`(verified || catch_all || mx_only) && blocklisted != true`, AND any incoming `filter`),
   build Brevo rows `{ email, attributes:{ FIRSTNAME, CLUB_NAME, COUNTRY, CITY, QUALITY } }`,
   chunk into ~1000 import items, and stash the eligible email set + `list_id` in staticData.
2. **Brevo import** (`POST /v3/contacts/import`, per chunk): upsert eligible into list 12.
3. **After push → Count → Make offsets → List page**: paginate list-12 members (incl.
   `emailBlacklisted`).
4. **Reconcile**: mark Brevo-flagged members `blocklisted=true` in our DB; remove from list 12
   every member no longer eligible (batched `POST …/contacts/remove`).
5. **Finish**: stamp `settings.brevo.last_sync`; report `Pushed N · removed M · blocklist-captured K`.

### 3. `brevo-contact-delete` (webhook `brevo-contact-delete`)
Fired by the PB delete hook, **not** a UI button. Body `{ email }`.
1. **HTTP "Brevo delete"** (credential `Brevo (api)`): `DELETE /v3/contacts/{{encodeURIComponent(email)}}`,
   **ignore HTTP errors** (404 = already gone → success). Returns `{ deleted: email }`.
No PB call needed.

### 4. `brevo-backfill` (webhook `brevo-backfill`) — one-time
Body `{ list_id? }`. **Defaults to the WHOLE Brevo account** (`GET /v3/contacts`) so the DB ends
up holding one row per address across *all* lists — Brevo here is region-segmented into several
lists, and the goal is a single source of truth. Pass an explicit `list_id` only to scope the
import to one list. (Note: this default is independent of `settings.brevo.list_id`, which is the
*push* target, a different concern.)
Async (webhook responds `{started:true}` immediately), with **deterministic paging** — n8n's
built-in offset pagination silently re-fetched page 0 and tripped its "identical response 5×"
guard, so we drive offsets ourselves:
1. **Respond** `{started:true}` → **Config** → **PB Auth**.
2. **Code "Resolve"**: pick the path (`/v3/contacts`, or `/v3/contacts/lists/{id}/contacts` when a
   `list_id` is passed).
3. **HTTP "Count"** (credential `Brevo (api)`): `GET <path>?limit=1` → read Brevo's total `count`.
4. **Code "Make offsets"**: emit one item per page — `{path, offset}` for `offset` in
   `0, 1000, … < count`.
5. **HTTP "Brevo page"** (per offset item): `GET <path>?limit=1000&offset=…` → that page's contacts.
6. **Code "Upsert into PB"**: flatten all pages, lower-case + dedupe emails, then **find-or-create**
   `{ email, source_type:'brevo' }` (no club) **concurrently** (chunks of 50). The `email` unique
   index makes it idempotent — emails already scraped are skipped, not duplicated. Returns
   `{ imported, skipped, total }`. *(Verified on prod: 8,004 Brevo contacts → 7,010 imported, ~994
   already present and skipped.)*

## Blocklist (unsubscribe / spam) — added 2026-06-12

Brevo exposes `emailBlacklisted: true` per contact (unsubscribed, hard-bounced, or marked spam).
These must never be re-contacted. Handling (decided via questionnaire — *flag + exclude
everywhere*, *both* manual + automatic freshness, *reuse Brevo attributes*):

- **Schema:** `contacts.blocklisted` (bool, migration `1780656200_contacts_blocklisted.js`). Kept
  but flagged — never deleted (so a re-scrape/re-import can't silently revive an opt-out).
- **Excluded everywhere:** the Brevo sync gate is `(verified || catch_all || mx_only) && blocklisted!=true`; Reoon "Pick
  contacts" skips blocklisted (no wasted credits); CSV export always filters out blocklisted
  (unless the "Only blocklisted" audit filter is active).
- **Capture + manual refresh:** `brevo-backfill` now reads `emailBlacklisted` for every Brevo
  contact and sets/updates `contacts.blocklisted` (create-or-update). Re-running it IS the manual
  "refresh blocklist" — relabelled in the UI as **"Import / refresh from Brevo"**. *(First run:
  1,439 of 8,004 flagged.)*
- **Automatic (real-time):** Brevo **marketing webhook** (`id 2035382`, events
  `unsubscribed`/`hardBounce`/`spam`) → n8n `brevo-unsubscribe` → marks the contact `blocklisted`
  (find-or-create by email, so an opt-out from an address we don't yet hold is still remembered).
- **UI:** a `blocklisted` red badge (table + dialog) and a blocklist filter (Any / Hide / Only).

### 5. `brevo-unsubscribe` (webhook `brevo-unsubscribe`) — live id `AXDiVMVZwLFlktKn`
Fired by the Brevo marketing webhook, not the UI. Body carries `{ event, email }`.
1. **Config → PB Auth → Code "Mark blocklisted"**: lower-case the email, find the contact and PATCH
   `blocklisted=true`; if absent, create `{ email, source_type:'brevo', blocklisted:true }`. Returns
   2xx fast so Brevo doesn't retry.

## PocketBase delete hook

`pocketbase/pb_hooks/brevo_contact_delete.pb.js` — baked into the image, runs server-side:

```js
onRecordAfterDeleteSuccess((e) => {
  const email = e.record.get("email")
  if (email) {
    const url = $os.getenv("N8N_BREVO_DELETE_URL") ||
      "https://n8n-2.biceps.digital/webhook/brevo-contact-delete"
    try {
      $http.send({ url, method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }), timeout: 10 })
    } catch (err) { console.log("brevo delete hook failed:", err) }
  }
  e.next()
}, "contacts")
```

- Fires on **every** contact delete, including cascade deletes when a club is removed (correct —
  those addresses should leave Brevo too).
- Non-fatal: a Brevo/n8n outage never blocks the PB delete; it just logs. (Reconciliation, if
  ever needed, is a future re-sync that diffs Brevo against our DB — out of scope.)
- The hook only knows the n8n base; the **Brevo secret stays in n8n**. Override the target with
  the `N8N_BREVO_DELETE_URL` env var.

## UI (`src/features/contacts/ContactsPage.tsx`)

The Contacts page `ActionsMenu` (today: "Export CSV") gains three actions, plus a delete in the
detail dialog:

- **"Verify emails (Reoon)"** → `triggerVerifyContacts({ filter })` → `verify-contacts-reoon`.
  Verifies the current filtered set (or all). Shows returned counts.
- **"Sync deliverable to Brevo"** → `triggerBrevoSync()` → `sync-contacts-brevo`. Pushes all
  deliverable (`verified` / `catch_all` / `mx_only`) contacts. Description spells out the gate.
- **"Import from Brevo (backfill)"** → `triggerBrevoBackfill()` → `brevo-backfill`. One-time; safe
  to re-run (idempotent). A confirm step notes it's a bulk import.
- **Delete** (in `ContactDetailDialog`): a "Delete contact" button → confirm →
  `pb.collection('contacts').delete(id)`. The PB hook then removes it from Brevo. Gives an
  in-app delete path; the hook guarantees propagation regardless of where the delete originates.

New `src/lib/n8n.ts` helpers (default path + `VITE_*` override, mirroring the existing ones):
`triggerVerifyContacts`, `triggerBrevoSync`, `triggerBrevoBackfill`. New env vars in
`.env.example` + `vite-env.d.ts`: `VITE_N8N_VERIFY_CONTACTS_URL`, `VITE_N8N_SYNC_BREVO_URL`,
`VITE_N8N_BREVO_BACKFILL_URL` (delete is server-side, no `VITE_*`).

The contacts table/detail already render `verification_status` (badge) and `source_type` (badge);
`brevo` source + Reoon-written statuses show automatically once the label/enum are added.

## Go-live prerequisites (operational — provided by the user, kept out of the repo)

1. **Brevo API key** → create n8n credential `Brevo (api)` (`httpHeaderAuth`, `api-key`).
2. **Reoon API key** → create n8n credential `Reoon (bulk)` (`httpCustomAuth`, JSON
   `{ "qs": { "key": "…" }, "body": { "key": "…" } }` — bulk-create needs the key in the body).
3. **Brevo newsletter list id** → set `settings.brevo.list_id` (PB admin).
4. Then PUT the four workflows live (keep `n8n/` exports in sync) and smoke-test:
   verify a handful → confirm statuses land → sync → confirm they appear in the Brevo list →
   delete one in-app → confirm it leaves Brevo → run the backfill once.

## Out of scope

- Automatic (real-time) verification or Brevo push — both are manual by decision (#1, #3).
- Pushing `unknown`/`unverified`/`undeliverable` to Brevo — gated out (#2). (`catch_all` and
  `mx_only` "Unable to verify" are now considered deliverable and **are** pushed — both mean the
  domain accepts mail.)
- Two-way attribute sync / pulling Brevo engagement (opens, clicks) back into our DB.
- Quality (A/B/C) scoring itself — still the separate Phase-4 work; Brevo just forwards whatever
  `quality` is set. Most contacts are unscored today, so QUALITY will often be blank in Brevo.
- A settings UI for `brevo.list_id` / `reoon.*` (set via PB admin for now).
