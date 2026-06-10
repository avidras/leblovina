# n8n workflows

Importable n8n workflow exports, version-controlled for reproducibility. The **running**
source of truth is n8n; these JSON files are the committed copy. **No secrets live here** —
the PocketBase admin login is an n8n **credential**, configured in the n8n UI.

## Phase 4 — Brevo sync + Reoon verification

Four workflows; design in [`specs/brevo-reoon-integration.md`](../specs/brevo-reoon-integration.md).
All follow the house pattern (**Webhook → Config → PB Auth → Code/HTTP**); Brevo and Reoon are
called from **credentialed HTTP Request nodes** (Code nodes can't read credentials).

- `verify-contacts-reoon.json` — `/webhook/verify-contacts-reoon`. Manual "Verify emails" button.
  Picks unverified/stale contacts (respects `settings.reoon.reverify_days`), verifies each via
  Reoon, writes `verification_status` + `verified_at`.
- `sync-contacts-brevo.json` — `/webhook/sync-contacts-brevo`. Manual "Sync deliverable to Brevo"
  button. Pushes only `verification_status='verified'` contacts (the deliverability gate) into the
  Brevo list `settings.brevo.list_id`, upserting attributes NAME/CLUB/COUNTRY/QUALITY.
- `brevo-contact-delete.json` — `/webhook/brevo-contact-delete`. Fired by the PocketBase
  `pb_hooks/brevo_contact_delete.pb.js` delete hook (not a UI button); hard-deletes the email in
  Brevo (404 tolerated).
- `brevo-backfill.json` — `/webhook/brevo-backfill`. One-time import of contacts already in Brevo
  into PB as `source_type='brevo'` (email only, no club). Idempotent on the `email` unique index.

### One-time setup (credentials — never committed)
1. **`Brevo (api)`** — n8n → Credentials → New → **Header Auth**, header **`api-key`** = your
   Brevo v3 API key. Re-select it on every Brevo HTTP node after import (the committed exports use
   the placeholder id `REPLACE_BREVO_CRED`).
2. **`Reoon (api)`** — New → **Query Auth**, param **`key`** = your Reoon API key. Re-select it on
   the `Reoon verify` node (placeholder id `REPLACE_REOON_CRED`).
3. Set **`settings.brevo.list_id`** (PB admin) to your Brevo newsletter list's numeric id.
4. The PB superuser credential is the existing `PocketBase admin (api)` (already wired by id).
5. Copy each production webhook URL into the matching `VITE_N8N_*` env var (see `.env.example`);
   the UI also falls back to `https://n8n-2.biceps.digital/webhook/<path>` if unset.

## `scrape-federations.json` — Phase 1 federations ingest

Webhook-triggered workflow that pulls the FIVB national federations from the VIS XML API and
find-or-creates them into PocketBase. This is the Phase 1 "Scrape federations" button's
backend. Design + field mapping: [`specs/federations-ingest.md`](../specs/federations-ingest.md).

Flow: **Webhook → Config → HTTP (FIVB VIS `GetFederationList`) → Parse XML → PB Auth
(credential) → Code (find-or-create on `fivb_code`) → Respond**.

### One-time setup
1. **Create the credential.** n8n → **Credentials → New → Custom Auth**, name it exactly
   **`PocketBase admin`**, and set the JSON to your PocketBase superuser login:
   ```json
   {
     "headers": { "Content-Type": "application/json" },
     "body": { "identity": "admin@biceps.digital", "password": "<superuser-password>" }
   }
   ```
   (This is the superuser you created in the Coolify container terminal.)
2. **Import** `scrape-federations.json` (Workflows → Import from File), or have it pushed via
   the API.
3. On the **PB Auth** node, set **Credential** = `PocketBase admin` (re-select it after import;
   credential IDs differ per instance).
4. Check the **Config** node — `pbUrl` should be `https://leblovina.tools.biceps.digital`.
5. **Activate** the workflow and copy its production webhook URL into the UI's
   `VITE_N8N_SCRAPE_FEDERATIONS_URL`.

No host environment variables are needed — the secret stays in the n8n credential store and
the non-secret PB URL lives in the Config node.

### Trigger
```bash
# full scrape
curl -X POST "<webhook-url>"
# rescrape (flag is read from the `rescrape` header)
curl -X POST "<webhook-url>" -H "rescrape: true"
```
Returns `{ ok, total, created, updated, failed, rescrape, errors }`.

### Notes
- The Code node reuses the token from the **PB Auth** node — Code nodes can't read
  credentials directly, so auth happens in that HTTP node and the token is passed downstream.
- `website_url` is normalized (`https://` prepended when the source omits a scheme).
- Re-runs are idempotent — find-or-create keys on the unique `fivb_code`; `status` is left
  untouched on update so Phase 2 club-discovery state is preserved.
