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
| 2 | Brevo deliverability gate | **Only proven-deliverable** (`verification_status='verified'`) | "Don't send non-deliverable emails." Read strictly: only Reoon-confirmed `verified` go to Brevo. `catch_all`/`unknown`/`unverified`/`undeliverable` are all held back until verified. Protects sender reputation. |
| 3 | Brevo push trigger | **Manual button** | Same as verification — explicit, controlled. Deletes still propagate automatically (see #4) so we never email a removed contact. |
| 4 | Delete semantics | **Hard-delete in Brevo**, propagated **automatically** via a PocketBase delete hook | One source of truth: gone here = gone there. The hook catches deletes from *anywhere* (UI, PB admin, API), not just a UI button. |
| 5 | Brevo attributes | **NAME, CLUB, COUNTRY, QUALITY** (besides EMAIL) | Enough for personalization + geographic/quality segmentation of campaigns. |
| 6 | Backfill provenance | `source_type='brevo'`, **no club**, email only | Brevo has no club data; import as bare emails so we hold one row per address. Idempotent on the `email` unique index — re-running creates nothing new. |

> **Supersedes:** an earlier draft answer set the Brevo scope to "all contacts." The Reoon gate
> (#2) replaces it — the push filter is now `verification_status='verified'`, full stop.

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

Reoon's `power`-mode single/bulk result carries a per-email `status` (and an
`overall_result`/`is_deliverable`). Map to our enum:

| Reoon status | our `verification_status` | goes to Brevo? |
|--------------|---------------------------|----------------|
| `safe` (deliverable) | `verified` | **yes** |
| `role_account` (deliverable role addr, e.g. info@) | `verified` | yes |
| `catch_all` | `catch_all` | no (gate #2) |
| `unknown` / temporary failure | `unknown` | no |
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
- **`Reoon (api)`** — generic `httpQueryAuth`, query param `key=<REOON_API_KEY>`. Base
  `https://emailverifier.reoon.com`.

### 1. `verify-contacts-reoon` (webhook `verify-contacts-reoon`)
Manual "Verify emails" button. Body `{ ids?, filter?, force? }` (omit → all not-recently-verified).
1. **PB Auth**.
2. **Code "Pick contacts"**: read `settings.reoon` (`reverify_days`). Resolve the target set
   (`ids` → those; `filter` → page clubs/contacts by filter; else all `contacts`). Drop any with
   `verified_at` within `reverify_days` unless `force`. Collect `{id,email}`; emit the unique
   email list.
3. **HTTP "Reoon bulk create"** (credential `Reoon (api)`): `POST /api/v1/create-bulk-verification-task`
   `{ name, emails:[…] }` → `task_id`. (Chunk to Reoon's per-task cap if needed.)
4. **Wait + HTTP "Reoon bulk result"**: poll `GET /api/v1/get-result-bulk-verification-task?task_id=…`
   until complete → per-email `{status,…}`.
5. **Code "Write back"** (PB): map each result (table above) → PATCH the matching contact(s)
   `{verification_status, verified_at}`. Stamp `settings.reoon.last_run`. Return counts
   `{verified, undeliverable, catch_all, unknown, skipped}`.

> Small sets may instead use single-email `GET /api/v1/verify?email=&mode=power` per the same
> mapping; the bulk task API is the default for scale.

### 2. `sync-contacts-brevo` (webhook `sync-contacts-brevo`)
Manual "Sync deliverable to Brevo" button. Body `{}` (syncs **all** eligible) or `{ filter }`.
1. **PB Auth**.
2. **Code "Build payload"**: read `settings.brevo.list_id` (error out clearly if unset). Page
   `contacts` where **`verification_status='verified'`** (AND any incoming `filter`), `expand=club`.
   Build Brevo rows `{ email, attributes:{ NAME, CLUB, COUNTRY, QUALITY } }`
   (NAME = contact name; CLUB = `name_en||name`; COUNTRY/QUALITY from the contact/club). Chunk
   into batches (~1000) → one item per chunk: `{ listIds:[list_id], updateExistingContacts:true,
   jsonBody:[…] }`. Also ensure the four attributes exist (idempotent
   `POST /v3/contacts/attributes/normal/{NAME|CLUB|COUNTRY|QUALITY}` via an HTTP node, ignoring
   "already exists").
3. **HTTP "Brevo import"** (credential `Brevo (api)`, per chunk): `POST /v3/contacts/import` with
   the chunk body. Upserts (create + update attributes) and adds to the list.
4. **Code "Finish"**: stamp `settings.brevo.last_sync = now`; return `{ pushed, batches }`.

### 3. `brevo-contact-delete` (webhook `brevo-contact-delete`)
Fired by the PB delete hook, **not** a UI button. Body `{ email }`.
1. **HTTP "Brevo delete"** (credential `Brevo (api)`): `DELETE /v3/contacts/{{encodeURIComponent(email)}}`,
   **ignore HTTP errors** (404 = already gone → success). Returns `{ deleted: email }`.
No PB call needed.

### 4. `brevo-backfill` (webhook `brevo-backfill`) — one-time
Body `{ list_id? }` (defaults to `settings.brevo.list_id`, else the whole account).
1. **PB Auth**.
2. **HTTP "Brevo list contacts"** (credential `Brevo (api)`, built-in offset pagination,
   `limit=1000`): `GET /v3/contacts/lists/{id}/contacts` (or `/v3/contacts` if no list) → all
   Brevo emails.
3. **Code "Upsert into PB"**: for each email, **find-or-create** a `contacts` row
   `{ email, source_type:'brevo' }` (no club). The `email` unique index makes it idempotent —
   existing emails (already scraped) are left untouched, not duplicated. Return
   `{ imported, skipped, total }`.

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
  `verified` contacts. Description spells out the gate ("only verified contacts are sent").
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
2. **Reoon API key** → create n8n credential `Reoon (api)` (`httpQueryAuth`, `key`).
3. **Brevo newsletter list id** → set `settings.brevo.list_id` (PB admin).
4. Then PUT the four workflows live (keep `n8n/` exports in sync) and smoke-test:
   verify a handful → confirm statuses land → sync → confirm they appear in the Brevo list →
   delete one in-app → confirm it leaves Brevo → run the backfill once.

## Out of scope

- Automatic (real-time) verification or Brevo push — both are manual by decision (#1, #3).
- Pushing `catch_all`/`unknown` to Brevo — gated out (#2); revisit only if reach is too low.
- Two-way attribute sync / pulling Brevo engagement (opens, clicks) back into our DB.
- Quality (A/B/C) scoring itself — still the separate Phase-4 work; Brevo just forwards whatever
  `quality` is set. Most contacts are unscored today, so QUALITY will often be blank in Brevo.
- A settings UI for `brevo.list_id` / `reoon.*` (set via PB admin for now).
