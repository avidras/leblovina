# Spec: Federations ingestion (Phase 1)

Populate the `federations` collection from the FIVB national-federations directory.

## Goal

Seed and keep-fresh the Phase 1 `federations` inventory (≈218 rows) from FIVB, triggered
from the UI's "Scrape federations" button and re-runnable idempotently ("Rescrape").

## Key finding — the "load more" is a non-issue

The FIVB page
(`https://www.fivb.com/inside-fivb/fivb/directory/national-federations/`) is a WordPress
page that mounts a **React widget** (`themes/fivb/react/dist/federations.js`). The widget
loads the **entire** federation list in a single request and "Load more" only reveals rows
already in the browser — there is **no server-side pagination to defeat, no browser
automation, no Apify needed**.

The widget's data comes from the FIVB **VIS** (Volleyball Information System) XML API:

```
GET https://www.fivb.org/Vis2009/XmlRequest.asmx
  ?Request=<Request Type="GetFederationList"
            Fields="Code CountryCode Address1 Address2 Name No ConfederationCode City
                    Category EmailAddress PhoneNo NamePresident NameGeneralSecretary
                    NoImageLogo TeamName Website"/>
```

(The `Request` value is URL-encoded.) One call returns all federations as
`<Federation .../>` elements. Verified: **218 rows** —
AVC 64, CEV 56, CAVB 54, NORCECA 33, CSV 11. The 5 `ConfederationCode` values map 1:1 to
our `confederation` enum.

Example row (attributes; note exact casing `eMailAddress`, `WebSite`):

```xml
<Federation Code="AFG" CountryCode="AF" Name="AFGHANISTAN VOLLEYBALL FEDERATION"
  No="1" ConfederationCode="AVC" City="KABUL"
  eMailAddress="a@x.org; b@y.com" PhoneNo="+93 799405555"
  NamePresident="Mr. Sayed Abdul Rahim Sadat" NameGeneralSecretary="Mr. Khushal MALIKZAI"
  TeamName="Afghanistan" WebSite="www.afghanistanvolleyball.org" Version="3284"/>
```

## Decisions (from interactive Q&A)

1. **Ingestion lives in n8n**, triggered by the Phase 1 "Scrape federations" webhook —
   aligns with CLAUDE.md (scraping lives in n8n; UI triggers via webhook). This repo owns
   only the schema + the webhook env var + this spec; the n8n workflow definition stays in
   n8n (out of scope for the repo).
2. **Stable identity key = `fivb_code`** (the VIS `Code`, e.g. `AFG`, `CEV-...`). Added as a
   unique field; the unique index moves off `country` onto `fivb_code`. Find-or-create keys
   on `fivb_code`, so country-name normalization can never create duplicates.
3. **`country` = the VIS `TeamName`** (human, e.g. "Afghanistan", "Chinese Taipei") — already
   clean and matches the export shape; no ISO lookup.
4. **Capture federation contact fields now**: `president`, `general_secretary`, `email`,
   `phone` (all real, deterministically extracted from VIS — compliant with the "never invent
   emails" rule). `email` may hold multiple addresses (VIS returns them `;`/`,`-separated);
   stored verbatim as text at federation level. Splitting into per-contact rows is Phase 3.

## Schema changes (migration)

New append-only migration `pb_migrations/<ts>_update_federations_fivb_fields.js`
(do **not** edit the create migration):

- Add `fivb_code` — text, **required**, unique.
- Add `president` — text.
- Add `general_secretary` — text.
- Add `email` — text (verbatim, may be multi-address).
- Add `phone` — text.
- Drop unique index on `country`; add unique index on `fivb_code`.
  (`country` stays a plain, non-unique field.)

Down migration removes the four contact fields + `fivb_code` and restores the `country`
unique index.

## Field mapping (VIS → `federations`)

| federations field   | VIS source                | notes                                        |
|---------------------|---------------------------|----------------------------------------------|
| fivb_code           | `Code`                    | stable dedup key                             |
| name                | `Name`                    | federation name (UPPERCASE in source; keep)  |
| country             | `TeamName`                | human country/team name                      |
| confederation       | `ConfederationCode`       | already one of CEV/AVC/CAVB/NORCECA/CSV       |
| website_url         | `WebSite`                 | **normalize**: prepend `https://` if no scheme; null if blank |
| president           | `NamePresident`           |                                              |
| general_secretary   | `NameGeneralSecretary`    |                                              |
| email               | `eMailAddress`            | verbatim; may be multi-address               |
| phone               | `PhoneNo`                 |                                              |
| source_url          | VIS request URL (const)   | provenance — the exact API call              |
| status              | `"new"` on create         | tracks club-discovery state (Phase 2); not overwritten on rescrape |
| last_scraped        | run timestamp             | set every run (the fed record was refreshed) |
| club_directory_url  | — (null)                  | filled in Phase 2                            |
| extraction_method   | — (null)                  | filled in Phase 2                            |
| notes               | — (null)                  | human notes                                  |

`City` is not in the Phase 1 federations schema (city lives on clubs/contacts later) — skip.

## n8n workflow

Importable export committed at `n8n/scrape-federations.json` (see `n8n/README.md`). Auth is an
n8n **Custom Auth credential** named `PocketBase admin` (PB superuser `identity`/`password`),
configured in the n8n UI — no host env vars, no secrets in the export. The non-secret PB URL
lives in the workflow's **Config** node. Design:

Webhook-triggered, single pass:

1. **Webhook** (POST). Reads a `rescrape` header (matching the existing n8n convention).
   `rescrape` does not change the fetch — it forces extraction even when `last_scraped` is
   set. For federations the pass is the same either way; the flag is plumbed for symmetry
   and to allow "skip recently-scraped" logic later.
2. **Config** (Set) — holds `pbUrl` + `visUrl` (non-secret).
3. **HTTP Request** → the VIS `GetFederationList` URL. Response is XML (text).
4. **XML parse** → array of `Federation` attribute objects.
5. **PB Auth** (HTTP Request) → `POST {pbUrl}/api/collections/_superusers/auth-with-password`
   using the `PocketBase admin` credential; returns the superuser token.
6. **Code** — maps each row (normalize `website_url`), then find-or-create per row using the
   token from PB Auth (Code nodes can't read credentials, so the token is passed in):
   - `GET /api/collections/federations/records?filter=(fivb_code='<code>')&perPage=1`
   - if found → `PATCH` that record (leave `status` untouched); else → `POST` with
     `status="new"`. On a unique-constraint race, re-query and PATCH. Reruns are idempotent.
   - Set `last_scraped` = run time on both paths.
7. **Respond** → `{ ok, total, created, updated, failed, rescrape, errors }`.

Later, the UI subscribes to PocketBase realtime on `federations`, so rows appear/refresh live
during the run.

The UI button POSTs to the webhook URL held in `VITE_N8N_SCRAPE_FEDERATIONS_URL`
(never hardcoded). Per-row "Rescrape" POSTs the same webhook with the `rescrape` header.

## File-level changes (this repo)

- `pocketbase/pb_migrations/<ts>_update_federations_fivb_fields.js` — schema migration above.
- `.env.example` — add `VITE_PB_URL` and `VITE_N8N_SCRAPE_FEDERATIONS_URL`.
- `CLAUDE.md` — update the `federations` field table (new fields + index on `fivb_code`),
  and note the VIS data source.
- `specs/federations-ingest.md` — this file.

## Out of scope

- The `PocketBase admin` n8n credential value + the live webhook URL (stay in n8n; the
  committed JSON has neither).
- Splitting federation `email` into per-contact rows, MX/verification, quality — Phase 3.
- `clubs` / `club_directory_url` / `extraction_method` population — Phase 2.
- The UI page + buttons themselves — tracked under the Phase 1 UI work, not this ingest spec
  (this spec covers the data source, schema, and webhook contract they depend on).
