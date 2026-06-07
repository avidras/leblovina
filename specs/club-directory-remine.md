# Spec: Directory re-mine (consistent backfill of contacts / website / detail_url)

Club extraction was built federation-by-federation with different extractors; each captured a
different subset of the per-club data that the directory HTML actually contains. Result: a club's
**email, website, and detail-page link are often present in the source listing but were dropped**
(e.g. FIPAV Udine lists each club's `mailto:`, website, and a detail `SId` inline — the html
extractor stored only the name; the DataProject extractor stored name+id but no detail link).

Fixing N extractors is whack-a-mole. Instead, **re-mine the directory pages once, uniformly.**

## Key fact that makes this cheap
All **9,570 clubs come from only ~95 distinct `source_url` directory pages** (63 hosts). Re-mining
those 95 pages backfills every federation in one mechanism.

## What it does (per `source_url` page)
1. **Load context** — query existing clubs that have this `source_url` (id, name, dedup_key,
   source_club_id, website_url, detail_url, federation); derive the federation + `fivb_code`. Build
   match maps: by `uslug(name)` and by `source_club_id`. Fetch the page HTML **preserving links**
   (mailto → inline `text <email>`, `<a href>` and `onclick document.location` targets kept).
2. **Extract (Gemini 2.5 Flash)** — return every club row:
   `{name, website, detail_url, contacts:[{email,name,position,phone}]}`. Multi-club per page.
3. **Match + backfill** — for each row, find the existing club by `uslug(name)` (primary) or by the
   id embedded in its detail link vs `source_club_id` (fallback). Then backfill:
   - `website_url` **only if the club has none** (never overwrite a resolved site); source `official_list`.
   - `detail_url` if empty (resolve relative → absolute against the page host).
   - `contacts` — find-or-create by email, `source_type='directory'`, `source_url` = the club's
     detail page if known else the directory page. Never invent emails (domain rule #1).
   - Log matched / unmatched / created-contacts counts. **Unmatched rows are logged, not created**
     (avoids dedup_key drift, see `club-dedup-stability.md`); recovering extractor-missed clubs is a
     possible follow-up, gated behind a flag.

## Matching (consistency with how clubs were keyed)
Reuse the canonical helper verbatim:
`uslug = s => String(s||'').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,60)`
- html/pdf feds: `dedup_key = <FIVB>:<uslug(name)>` → match by `uslug(name)`.
- catalog/api/dataproject feds: `dedup_key = <FIVB>:<id>`, `source_club_id` set → match the id parsed
  from the row's detail link against `source_club_id`; fall back to `uslug(name)`.

## n8n shape (as built — workflow id `VKsBF9Saxxs0fLEP`)
`extract-directory-data` (webhook `{source_url}` | `{fedId}` | enumerate-all): Targets → Loop
(splitInBatches) → Load context → Extract directory (Gemini) → Backfill → loop. `responseMode:
lastNode` so a single `{source_url}` call returns its `{matched,unmatched,website_set,detail_set,
contacts}` synchronously (CLI-drivable). Reuses PB-admin + Gemini creds. Idempotent (contacts
unique by email; website/detail fill-if-empty) → safe to re-run. Drive the ~95 pages from the CLI.

**Link/email preservation (critical):** `Load context` keeps anchors as `[link:URL]`, onclick
detail navigations as `[link:URL]`, and mailto as `[mail:EMAIL]` — NOT `<email>` (angle brackets
get eaten by the tag-strip, which is why early runs returned zero emails). The Gemini prompt reads
those tokens.

## At-extraction integration (not post-fix only)
Extractors run **async** (`process-federation` fires them `onReceived` and returns), so the re-mine
cannot be a synchronous step in `process-federation` — clubs don't exist yet. The hook therefore
lives in each **generic-HTML extractor's terminal node** (after clubs are created): `extract-clubs-
html` and `extract-clubs-federated` POST `{fedId}` to `extract-directory-data` at the end. So fresh
extractions backfill website/detail/contacts automatically. `api`/`pdf`/platform extractors capture
structured data inline already and don't need it. New generic directory extractors should add the
same one-liner.

## Idempotency / safety
- Fill-if-empty for `website_url`/`detail_url`; contacts upsert by unique `email`. Re-runs converge.
- Scope by federation/confederation/page to control spend; ~95 Gemini calls for the full sweep
  (chunk pages that exceed the context window).
- Does **not** create clubs or overwrite resolved websites.

## Skill
`leblovina-remine-directories` — run/inspect the re-mine over a federation, a confederation, or all
95 pages; report matched/backfilled/contacts-gained.

## Out of scope
- Creating extractor-missed clubs (logged only; later, flag-gated).
- Deep per-club site crawling (that's `leblovina-scrape-contacts` / the site-scraper).
- Email verification / quality scoring (Phase 3+).

## Build order
1. Spec (this). 2. `extract-directory-data` workflow + deploy. 3. Validate on a table directory
   (FIPAV Udine), a DataProject page (UKR), and a catalog page (Bulgaria). 4. Skill. 5. Backfill all
   95 pages; log coverage before/after. 6. Sync docs (CLAUDE.md clubs notes, STATUS).
