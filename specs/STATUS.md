# Project status & handoff (living doc)

Update this when you finish a chunk of work. A new session should read `CLAUDE.md`
(conventions + how to drive the n8n/PocketBase APIs from `.env`) then this file.

> **The end-to-end plan now lives in `specs/implementation-roadmap.md`** (canonical, phased).
> This file remains the live state + resource IDs. **Done:** Phase 0 (commit), Phase 1 (Resolve
> LLM relevance + two modes), Phase 2.1 (deterministic `club_count`), 2.1b (name-only dedup +
> 107-dupe cleanup, re-runs now idempotent), 2.3 (Contacts UI + `source_type` tag). **Next:**
> Phase 2.2 — make the detail-page contact harvest batched/async and auto-run inside
> `process-federation` (the 139-club sync run hit n8n's execution timeout; needs bounded
> batches + a driver). Then Phase 3 (Europe-wide run + count QA), 4 (Apify/platform), 5 (site scraper).
> New workflow id: extract-club-contacts `wbiJdurHtKbbQtye`.

_Last updated: 2026-06-06._

## Where things stand

- **Detection (directory discovery): solid.** Per federation we reliably find the club
  directory URL(s) + an approximate club count (in the discovery note).
- **Extraction: hardened and working** (this session). Chunked LLM extraction + never-crash
  JSON parsing + cleanliness-gated model (Haiku for clean tables/lists, Sonnet for messy) +
  inline **contact capture**. See `specs/club-extract-robustness.md`,
  `specs/club-contacts-from-directory.md`.
- Prod totals: **clubs ~3,442, contacts ~769** (contacts seeded from directories that expose
  them: Portugal 50, Australia 34, Czechia 448, …).

## Live resources (all driven via `.env` creds — see CLAUDE.md "Managing deployed workflows")

- PocketBase (prod): `https://leblovina.tools.biceps.digital` — collections: federations,
  clubs, **contacts** (`pbc_1930317162`), settings. Admin via `PB_ADMIN_EMAIL/PASSWORD`.
- n8n: `https://n8n-2.biceps.digital`, key `N8N_API_KEY`. Workflows (id | webhook):
  - Extract clubs (html)  `JRsYkaG9BuEM2CMO` | `/webhook/extract-clubs-html`
  - Extract clubs (pdf)   `ThFNP7OTJBreBi1v` | `/webhook/extract-clubs-pdf`
  - Extract clubs (api)   `w9sLRJIfFfIMWFZG` | `/webhook/extract-clubs`
  - Process federation    `Jja5unwVathVFd1Y` | `/webhook/process-federation` (discover→gate→route)
  - Enrich/Resolve website `jOeufPcBBIWrij7M` | `/webhook/enrich-club`
- Trigger an extractor: `POST {webhook} {"id":"<fedId>"}` (optionally `"url":"<dir>"` to force one dir).
- **Exports under `n8n/` are NOT auto-applied** — edit the export AND PUT to the live workflow
  (keep them in sync). Same for the contacts collection (migration committed + created via API).

## Open items / next steps (prioritised)

1. **CZE over-extraction (909, should be ~160).** It scraped both `cvf.cz/cvs/oddily/` (clubs)
   and `cvf.cz/cvs/adresar/` (address book of teams/officials). Restrict CZE to `oddily` (drop
   the `adresar` directory entry) and re-run.
2. **needs_review JS/AJAX directories:** Cyprus (`volleyball.org.cy/somatia` — clubs load via
   AJAX; Firecrawl markdown was only ~6k chars), Belgium (volleyvlaanderen/FVWB JS apps),
   Albania (DataProject `.aspx` per-competition). Recover via Firecrawl JS-render
   (`waitFor`/actions) or each platform's API. Australia is federated (8 sub-sites) — 3 yielded,
   5 need per-site handling.
3. **Discovery clobbers `directory_urls`.** Re-running discovery on a federation overwrites good
   `directory_urls` with `[]` when it finds nothing (it wiped Estonia twice this session, which
   also flipped EST to needs_review despite having 41 clubs). Fix discovery to never blank
   existing directories on an empty result.
4. **Detail-page contacts (Bulgaria).** Contacts live on each club's detail page, not the list.
   Specced as a follow-up sub-step in `club-contacts-from-directory.md` — not built yet.
5. **Cross-extractor dedup inconsistency (latent).** embedded-JSON uses
   `<fed>:<urlPath(detail)>`; html/pdf use `<fed>:<uslug(name)>:<uslug(city)>`. Safe under normal
   one-extractor-per-fed routing, but re-running a fed through a different extractor duplicates it
   (hit this with Bulgaria; cleaned up). Consider unifying.

## How to resume in a new session
1. Read `CLAUDE.md` then this file.
2. `git log --oneline -15` for what landed.
3. Re-derive the current failure set: query federations with non-empty `directory_urls`, compare
   each club count vs the discovery-note estimate (the script pattern used this session lives in
   git history / can be regenerated).
