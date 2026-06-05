# n8n workflows

Importable n8n workflow exports, version-controlled for reproducibility. The **running**
source of truth is n8n; these JSON files are the committed copy. **No secrets live here** —
credentials and the webhook's full URL stay in n8n.

## `scrape-federations.json` — Phase 1 federations ingest

Webhook-triggered workflow that pulls the FIVB national federations from the VIS XML API and
find-or-creates them into PocketBase. This is the Phase 1 "Scrape federations" button's
backend. Design + field mapping: [`specs/federations-ingest.md`](../specs/federations-ingest.md).

Flow: **Webhook → HTTP Request (FIVB VIS `GetFederationList`) → Parse XML → Code
(PocketBase auth + find-or-create on `fivb_code`) → Respond**.

### Import
1. n8n → Workflows → Import from File → select `scrape-federations.json`.
2. Set these n8n **environment variables** (Settings → Environments, or the host env):
   - `POCKETBASE_URL` — e.g. `http://localhost:8090` (or the prod PB URL)
   - `POCKETBASE_ADMIN_EMAIL` — a PocketBase superuser
   - `POCKETBASE_ADMIN_PASSWORD`
3. Activate the workflow and copy its production webhook URL into the UI's
   `VITE_N8N_SCRAPE_FEDERATIONS_URL`.

### Trigger
```bash
# full scrape
curl -X POST "<webhook-url>"
# rescrape (flag is read from the `rescrape` header)
curl -X POST "<webhook-url>" -H "rescrape: true"
```
Returns `{ ok, total, created, updated, failed, rescrape, errors }`.

### Notes
- The Code node reads PB creds from `$env`. If your n8n sets
  `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, either unset it or replace the three `$env.*` reads
  with an n8n credential. Never paste the password into the committed JSON.
- `website_url` is normalized (`https://` prepended when the source omits a scheme).
- Re-runs are idempotent — find-or-create keys on the unique `fivb_code`; `status` is left
  untouched on update so Phase 2 club-discovery state is preserved.
