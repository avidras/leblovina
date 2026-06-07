# Site-scrape page capture (audit trail of what was fetched)

## Goal

Make every site-scrape **auditable**: for each club we scrape, record which pages were
identified and fetched, how (plain HTTP vs Firecrawl render), their HTTP status/size, the
cleaned text the LLM actually saw, and the **raw HTML/markdown** as fetched. This lets us
debug extraction misses (e.g. a `no_contacts` where the email was on a page we didn't reach),
re-run extraction offline against stored content, and verify provenance per contact.

## Decisions (from the design Q&A)

1. **Capture depth = metadata + cleaned text + raw HTML** per page.
2. **Storage = a new `scrape_pages` collection** (1 club → N page rows). Metadata + cleaned
   text live in fields; the **raw HTML/markdown is a PocketBase file attachment** (stored on
   disk under `pb_data/storage`, not inline in SQLite) so the DB stays lean at GB scale.

## Schema — new collection `scrape_pages`

| field | type | notes |
|-------|------|-------|
| club | relation → clubs | required; cascade-friendly. Indexed. |
| url | text | the page URL fetched |
| role | select | `homepage` / `candidate` / `detail` (federation directory page) |
| method | select | `http` (plain fetch) / `firecrawl` (JS render) |
| http_status | number | status code (0 if fetch failed) |
| bytes | number | size of the raw content captured |
| used | bool | whether this page's text was fed to the extractor |
| emails_found | number | distinct emails the extractor/regex pulled from this page |
| text | text (long) | the **cleaned** text sent to the LLM for this page |
| raw | file | the **raw** HTML (plain fetch) or markdown (Firecrawl) as fetched |
| run_at | date | scrape timestamp (groups a club's pages from one run) |

- Index on `club`. Migration is **idempotent** (guard `findCollectionByNameOrId`) per CLAUDE.md.
- **Re-scrape replaces:** at the start of a club's scrape the worker deletes that club's prior
  `scrape_pages` rows, then writes the fresh set — so a club always reflects its latest run and
  re-runs don't accumulate.

## Worker changes (`site-scrape-club`)

- The **Crawl** node already builds the page set (homepage + up to 4 candidates + detail). It
  now also returns a structured `pages[]` array: `{url, role, method, http_status, bytes,
  used, text, raw}` for every page it touched (homepage incl. whether Firecrawl markdown or
  plain HTML was used; each candidate; the detail page).
- A new **Write pages** Code step (fan-out from `Extract contacts`, alongside `Write`): deletes
  the club's existing `scrape_pages`, then for each page creates a row with metadata + `text` +
  `emails_found` (attributed from the extractor's per-contact `source`) via a plain JSON POST.
  For each page that has raw content it emits a binary item (`prepareBinaryData` stamps the
  filename `<role>-<n>.html|.md` + mime).
- An **Upload raw** HTTP Request node (multipart/form-data, `parameterType: formBinaryData`,
  field `raw` ← binary `data`) PATCHes each emitted item's raw file onto its `scrape_pages`
  record. **Why a separate node:** n8n Code-node helpers (`httpRequest` with a Buffer/`FormData`
  body, and the legacy `request` `formData`) do NOT produce a real multipart upload to PB — the
  only reliable path is `prepareBinaryData` in Code + an HTTP Request node in multipart mode.
- Both `Write pages` and `Upload raw` are best-effort (`onError: continueRegularOutput`) — page
  capture must never break the contact write (contacts are the product; the audit trail is
  secondary). Metadata + cleaned text persist even if a raw-file upload fails.
- **New webhook path `site-scrape-club-v2`** (and driver points at it). This also neutralises
  the orphaned old driver chains from the aborted run — they POST to the now-dead
  `/webhook/site-scrape-club` and no-op.

## Driver change (`site-scrape-driver`)

- `Fire worker` URL → `/webhook/site-scrape-club-v2`. No other change (C-exclusion and the
  `scrape_note`-based "already scraped" filter from the previous round stay).

## UI (optional, light)

- A club's detail dialog can list its `scrape_pages` (url, role, method, status, emails_found)
  with a link to download the stored raw file — a "what we scraped" panel. (Can follow later;
  the data is captured regardless.)

## Out of scope

- Storing screenshots / rendered DOM beyond Firecrawl markdown.
- Diffing pages across runs (we replace, not version).
- Retention/expiry policy for old `raw` files (revisit if disk grows large).

## Validation

Re-scrape a handful of POL A-clubs; confirm each gets `scrape_pages` rows (homepage + the
candidate pages), `raw` files downloadable, `text` populated, `method` correct (http vs
firecrawl), and that contact extraction is unchanged. Confirm re-running replaces (no dupes).
