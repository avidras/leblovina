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
>
> **Phase 3 round 1 done (2026-06-06 late):** Europe-wide run + count-QA + extractor revision.
> Fixed: async extractors (60s code-timeout), discovery `maxIterations` 7→18 (recovered GER/ESP),
> `js`→Firecrawl-render routing (recovered SLO/SRB/SCO), federated extractor v1 (`extract-clubs-
> federated` MZGXbnSIKqY9O57c — DEN 0→3, NOR JS-tabs still 0), site-scrape worker+driver
> (`site-scrape-club` bMYkYfjGXek63kox, `site-scrape-driver` Ggc7pFlFgBUVGsm2; JS-render via
> Firecrawl; `clubs.scrape_note`), Gemini 2.5 Flash for high-volume LLM (cred `bk0TwlDz0lEZUfic`),
> URL-synced UI filters. **CEV now 39/56 federations with clubs (~4,454); 4,790 clubs / 1,586
> contacts total.**
> **Remaining long tail (16 dir-but-0 + GIB):** NED(Nevobo API), ALB(DataProject), NOR(JS-tab
> actions), CYP/MON(Apify), SUI/LAT/BIH/WAL(dirs found, extraction 0 — per-case), FRA/ISL/SVK/
> SWE/UKR/GRL/NIR(mixed). Plus: wire federated/site-scraper into routing; fix the noisy
> `club_count` heuristic; Apify anti-bot tier (Phase 4).
>
> **Phase 3 round 2 (2026-06-07):** Federated extractor validated + **auto-routed** (>2 regional
> dirs → `extract-clubs-federated`): GER 93→163, ESP 41→135, BIH 0→8. **Nevobo open API
> extractor** (`extract-clubs-nevobo` 42Ur1JEWgaQkDZ0a): **NED 0→1,739 clubs + ~1,600 contacts**
> (email/phone) in ~100s, deterministic. DB now ~6.5k clubs / ~3.2k contacts.
> **Still open:** SUI (Swiss Volley = SportManager portal `api.volleyball.ch` HTML + an
> apiary-documented API needing a key — deferred); NOR (JS-tab actions); CYP/MON (Apify);
> deeper federated crawl for *full* GER/ESP coverage; auto-route Nevobo/FFVB/site-scraper;
> fix club_count heuristic.
>
> **Phase 3 round 3 (2026-06-07):** **FFVB open enumeration** — France's `ffvbbeach.org/ffvbapp/
> adressier/recherche.php` POSTs one committee code (`ws_new_comit`, 105 départements) to
> `rech_aff_club.php`, each result page listing every club with code + name + email + website.
> Built `extract-clubs-ffvb` (`Vz1NsAbq4JWzwZr8` | `/webhook/extract-clubs-ffvb`): deterministic
> regex parse (windowed per 7-digit club code; skips `*0000` committee entries; drops social
> URLs), windows-1252→latin1 decode (accents clean), dedup `FRA:<code>`, upserts clubs +
> contacts (`source_type:'directory'`). **FRA 0→1,310 clubs + 1,255 contacts** (687 w/ website)
> in ~58s, deterministic. DB now ~8,476 clubs / 4,447 contacts.
> _Note: Finalize copies the Nevobo pattern that PATCHes `scrape_note` onto the federation, but
> that field only exists on `clubs` — PB silently drops it. Harmless (status + club_count persist);
> clean up if a federation-level run note is ever wanted (write to `notes`)._
> **Remaining of the user's 4 high-potential feds — investigation in progress (resume here):**
> - **FRA — DONE** (1,310 clubs / 1,255 contacts; see above).
> - **SWE (Sweden):** federation `volleyboll.se` runs on **Profixio** — the find-a-club page
>   (`/forbundet/valkommen-till-volleyboll/hitta-forening`) points at
>   `https://www.profixio.com/fx/terminliste.php?org=SVBF.SE.SVB` (org code **`SVBF.SE.SVB`**).
>   Also has 5 district pages under `volleyboll.se/forbundet/distrikt/*`. **Next:** find Profixio's
>   club-registry endpoint for that org (try the profixio app/API — `profixio.com/app/...`,
>   tournament/club JSON) and enumerate. Profixio is a Nordic platform; cracking it likely also
>   helps NOR/other Nordics.
> - **SVK (Slovakia):** `slovakvolley.sk` is a Next.js SPA on the **eliterro** platform; API host
>   is **`api.volley.eliterro.sk`** (confirmed via image URLs `?path=…`). `/api/club|clubs|kluby|
>   team|teams|oddiel` all 404 — endpoint path still unknown. `slovakvolley.sk/page/adresare`
>   renders competition lists, not a clean club address book (clubs likely under a competition or a
>   different API route). **Next:** inspect the SPA's JS bundle / network calls (Firecrawl-render or
>   fetch the Next.js `_next/data/*.json` for the adresare route) to find the real club endpoint on
>   `api.volley.eliterro.sk`. Old dir `volleynet.sk/article/...` is a stale CMS article.
> - **NOR (Norway):** `volleyball.no` is WordPress but clubs are **not** a WP post type
>   (`/wp-json/wp/v2/types` has no club/klubb type) and **not** inline on `/klubborganisasjon`
>   (no admin-ajax/nonce/iframe found in static HTML — JS-injected from an external register,
>   likely NIF/SportsAdmin or Profixio). **Hardest of the three.** Next: Firecrawl-render
>   `/klubborganisasjon` to capture the live XHR, or check if NOR volleyball is also on Profixio.
>
> **Pattern:** each is a per-platform enumeration like Nevobo (NED) and FFVB (FRA). When the
> backend is an open/guessable API or POST-enumerable form → build a dedicated deterministic
> extractor (fast, clean, captures emails). Only fall back to Firecrawl-render/Apify when there's
> no reachable backend (NOR may be this case).

> **Phase 3 round 4 (2026-06-07, recon only — NO data/extractor/workflow changes this session):**
> Validated all `.env` creds (PB, n8n, Serper, Firecrawl, Apify, Anthropic — all HTTP 200).
> Re-derived the true zero-club set by **counting actual `clubs` records** (the `federations.club_count`
> field is STALE — don't trust it; count via `clubs?filter=federation='<id>'` totalItems).
> **10 CEV federations still at 0 clubs:** ALB, CYP, GIB, LAT, MON, NOR, SVK, SWE, SUI, UKR.
> Key reality check: the discovery `notes` for these **overstated** "static club table" — most are NOT
> clean registries. Verified per-fed:
> - **SUI (biggest prize, ~hundreds of clubs):** club search at volleyball.ch/de/verband/services/verein-suchen
>   is **Algolia-backed**. Index name confirmed **`clubs-0`** (sort replicas `_zip_asc`, `_caption_asc`).
>   The REST API `https://api.volleyball.ch/indoor/clubs` exists but returns `{"errors":[{"message":"Valid
>   API-Key required"}]}`. Algolia appId + search key are **runtime-injected** — NOT in the Next.js static
>   chunks (`/_next/static/chunks/94-*.js` holds the InstantSearch wiring + `indexName:"clubs-0"`, but
>   `searchClient` is an imported var with no literal appId/key) and NOT in the Firecrawl-rendered DOM
>   (page renders no clubs until interaction). **Next:** capture the live Algolia XHR (`{appId}-dsn.algolia.net
>   /1/indexes/clubs-0/query` + `X-Algolia-API-Key`) via a real browser — Apify Puppeteer/Playwright actor
>   with request interception, or check the Swiss Volley Apiary (`swissvolley.docs.apiary.io`) for an open
>   key. Once appId+searchKey known → POST Algolia browse/query, paginate, deterministic. Highest ROI target.
> - **LAT:** volejbols.lv/komandas is only league-group rosters (team name + coach, ~15 rows, no city/site/
>   email). Thin; capturable but low value.
> - **UKR:** fvu.in.ua/uk/taxonomy/term/521 is a thin Drupal **tag** page (6 teasers, 0 mailto) — NOT a club
>   registry. The discovery "lists_clubs:true" was a hallucination. Need to find a real club page on fvu.in.ua.
> - **ALB:** fshv.org.al homepage has NO `<table>`/`<tr>` in raw HTML (claim of ~96-club table is suspect);
>   needs real recon (check menu for Klube page, sitemap, wp-json).
> - **CYP/MON/SVK/SWE/NOR:** not re-investigated this session beyond prior notes (round 3). SVK=eliterro
>   `api.volley.eliterro.sk` (path unknown), SWE=Profixio `org=SVBF.SE.SVB` (api.profixio.com didn't resolve
>   from this network — retry) or RF/IdrottOnline registry, NOR=external register behind volleyball.no JS.
> - **GIB:** genuinely no website / club directory (social media only) — likely mark resolved-no-source.
> _Method for next session: do focused per-fed recon (max 2 parallel agents — run resources are limited),
> find the real deterministic source or declare none, then build a dedicated extractor like Nevobo/FFVB._
>
> _Permissions aside: file-based `permissions.defaultMode:bypassPermissions` did NOT stick — the running
> session re-serializes `.claude/settings.local.json` and strips it. Use Shift+Tab (bypass mode) or
> `claude --dangerously-skip-permissions` instead._

> **Phase 3 round 5 (2026-06-07):** **SVK cracked — eliterro open API.** `slovakvolley.sk`'s
> backend `api.volley.eliterro.sk` exposes a **public Swagger** (`/swagger/v1/swagger.json`, 93
> routes) and an open `GET /clubs?count=1000` (95 clubs) + `GET /clubs/{id}` detail with
> `address` (city/street/postcode), `contacts` (Web/FB/IG), and **`people[]` with Email + Phone**.
> Built `extract-clubs-eliterro` (`pq5ObaOqWYMvkJuk` | `/webhook/extract-clubs-eliterro`):
> Build clubs (list) → splitInBatches(1) → Process club (fetch detail, find-or-create club by
> `dedup_key='SVK:'+id`, contacts by email) → Finalize. **SVK 0→95 clubs + 90 contacts** (named
> club-representatives w/ email+phone), 66 w/ website, 94 w/ city — deterministic, ~90s.
> eliterro is a Slovak platform; likely SVK-only (not seen on other CEV feds).
> **SWE partial — 0→11 clubs + 11 contacts (clean emails).** `volleyboll.se` runs on SiteVision
> and routes "find a club" entirely to Profixio (`org=SVBF.SE.SVB`). Profixio's only public surface
> is `fx/terminliste.php` (tournament invitations) + a Filament/Livewire app (`/app`, no public REST
> — `/app/api/v1/*` all 404) → **browser-only, and email-less**. The one clean source: the
> **Stockholm-Gotland district** find-a-club page embeds a JS `clubs=[{name,Link,Instagram,Email}]`
> array (Leaflet map). Built `extract-clubs-svbf-map` (`Isoaq7s7VfszJcrM` |
> `/webhook/extract-clubs-svbf-map`): GET page → regex the `clubs=[…]` array → JSON.parse →
> find-or-create club (`dedup_key='SWE:'+uslug(name)`) + contact by email. Takes `{id,url,region}`
> so it generalizes to any district that adds such an array (only Stockholm-Gotland has one today;
> national + other 4 districts route to Profixio). **Full SWE (hundreds of clubs) remains
> browser-only via Profixio with NO emails — low lead-gen value, deferred.** svenskalag.se "sok"
> is a text search (9 hits), not a sport directory.
> **SUI done (partial) — 0→27 clubs + 16 contacts (clean emails).** Apify puppeteer-scraper
> (now approved) was used **only to discover** that volleyball.ch's club search does NOT call
> Algolia directly — it POSTs to a **same-origin Searchkit proxy** `https://www.volleyball.ch/
> api/searchkit/club-search` with an Algolia-style body `[{indexName:'clubs-0',params:{query,
> hitsPerPage,page}}]` and **needs no API key**. So the Algolia appId/searchKey hunt was moot.
> Built `extract-clubs-sui` (`zGJj5ZTSGfK0iAJ4` | `/webhook/extract-clubs-sui`): POST empty
> query hitsPerPage 1000 → hits carry `caption`(name)/`city`/`zip`/`website`/`email` → upsert
> club (`dedup_key='SUI:'+objectID`) + contact. Keyless, browserless, deterministic, ~5s.
> **The `clubs-0` index has only 27 opt-in club cards (match_all nbHits=27) — the recon's
> 'hundreds' was wrong.** The full Swiss roster is behind the authenticated `api.volleyball.ch/
> indoor/clubs` ('Valid API-Key required') — deferred.
> **Zero set now 7:** ALB, CYP, GIB, LAT, MON, NOR, UKR. (SVK done; SWE + SUI off-zero, partial.)
> **SUI blocker confirmed dead-end statically:** Algolia appId+searchKey are runtime-injected —
> NOT in HTML, NOT in any `/_next/static/chunks/*.js` (only the Sentry DSN `…@sentry.visol.ch` and
> `indexName:"clubs-0"` are literals; `searchClient` is an imported var, `[appId,apiKey]` read from
> `l.client` at runtime). Needs a real browser to capture the live `{appId}-dsn.algolia.net` XHR.
> **Apify browser actors (puppeteer/web-scraper) require one-time console permission approval**
> (`full-permission-actor-not-approved`) — can't be done from the API/CLI. To unblock SUI: either
> approve the actor in the Apify console, or paste the Algolia App-ID + Search-API-Key from a
> browser DevTools Network capture (the `X-Algolia-Application-Id` / `X-Algolia-API-Key` request
> headers on volleyball.ch's verein-suchen search). **SWE:** Profixio is a Laravel API
> (`/app/api/v1/...` returns `{"message":"The route … could not be found."}`) — real route still
> unknown; classic `profixio.com/fx/` is tournament-invitation pages, not a clean registry.
>
> _Last updated: 2026-06-07 (round 5 — SVK done)._

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
  - Extract clubs (eliterro/SVK) `pq5ObaOqWYMvkJuk` | `/webhook/extract-clubs-eliterro`
  - Extract clubs (SVBF map/SWE) `Isoaq7s7VfszJcrM` | `/webhook/extract-clubs-svbf-map`
  - Extract clubs (searchkit/SUI) `zGJj5ZTSGfK0iAJ4` | `/webhook/extract-clubs-sui`
  - Extract clubs (FFVB/FRA) `Vz1NsAbq4JWzwZr8` | `/webhook/extract-clubs-ffvb`
  - Extract clubs (Nevobo/NED) `42Ur1JEWgaQkDZ0a` | `/webhook/extract-clubs-nevobo`
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
