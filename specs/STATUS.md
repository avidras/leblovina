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

> **Phase 3 round 6 (2026-06-07) — cleared the remaining 7 zero-club feds.**
> - **NOR — 310 clubs + 310 contacts (all w/ email, 236 w/ website).** `volleyball.no/klubboversikt/`
>   is a static 312-row table `Klubb | Poststed | E-post | Nettside` with **Cloudflare-obfuscated
>   emails** (`data-cfemail`, decoded: first hex byte = XOR key). Built `extract-clubs-nor`
>   (`3F0l7csD11ihAmMJ` | `/webhook/extract-clubs-nor`), dedup `NOR:<uslug(name)>`, batched loop.
>   ⚠️ **NOR also has a duplicate 311-club set** from a pre-existing `Extract clubs (NIF ClubSearch)`
>   workflow (`zA8cUjhYy1469qHl`, no repo export, ran once 09:16) sourced from `minidrett.no/idrettslag`
>   — numeric dedup `NOR:<id>`, **no contacts, no websites**. Strictly inferior; recommend deleting
>   that set (klubboversikt set supersedes it). NOR fed currently shows 621 clubs until deduped.
> - **CYP — 31 clubs (names only, no contacts).** `volleyball.org.cy/somatia` lists clubs as static
>   Greek `<li>` items. The site WAF 406s bare `Mozilla/5.0` — needs full browser headers (UA+Accept).
> - **LAT — 9 clubs (names only).** `volejbols.lv/komandas` is youth-competition team rosters
>   (team + coach, no contacts); captured distinct team names.
> - CYP+LAT done via new generic **`extract-clubs-namelist`** (`Nq3ffFPlplikrqRw` |
>   `/webhook/extract-clubs-namelist`): body `{id,url,country,prefix,mode,region}`, `mode` = `cyp_li`
>   (Greek `<li>`) or `lat_td` (table column). Full browser headers to pass WAFs. Name-only, no contacts.
> - **No clean source → marked `needs_review` with recon notes:** **ALB** (fshv.org.al has no club
>   table/page; portfolio CPT is theme demo — the ~96-club claim was inaccurate), **GIB** (no website,
>   social-only), **MON** (federation domain dead; Code Sport Monaco annuaire's Volley-ball section is
>   empty), **UKR** (fvu.in.ua has only competition pages, no club registry).
> **Zero-club CEV set: CLEARED.** All former zero feds now either have clubs (SVK/SWE/SUI/CYP/LAT/NOR)
> or are resolved no-source (ALB/GIB/MON/UKR).
>
> _Last updated: 2026-06-07 (round 6 — remaining 7 cleared)._
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
> > **Phase 3 round 6 (2026-06-07) — Apify Puppeteer approved; NOR + UKR + ALB cracked.**
> Used the approved Apify actor **`puppeteer-scraper` (`YJCnS9qogi9XxDgLB`)** for *recon only*
> (capture live XHRs / render nav), then built keyless deterministic extractors.
> - **NOR 0→311 clubs.** `volleyball.no/klubboversikt` embeds the NIF **MinIdrett** registry
>   (`minidrett.no/idrettslag`). Real API: **`restdistribution.nif.no/api/v1/ClubSearch`** (POST
>   `{ClubName:'',RegionId:0,ActivityId:38,PageSize:100,Index:N}`; ActivityId **38 = Volleyball**;
>   keyless; paginated; Count=311). Returns name/city/zip/LocalCouncil — **no email/website**
>   (those via Resolve + site-scrape later). `ClubDetails` needs auth (401). Swagger:
>   `restdistribution.nif.no/swagger/docs/v1`. Built **`extract-clubs-nif`** (`zA8cUjhYy1469qHl` |
>   `/webhook/extract-clubs-nif`), dedup `NOR:<OrgId>`.
> - **UKR 0→275 clubs + ALB 0→25 clubs** via a new **reusable DataProject extractor**
>   **`extract-clubs-dataproject`** (`x0JKgaz4Y2lOSLc9` | `/webhook/extract-clubs-dataproject`).
>   DataProject team pages (`<host>.dataproject.com/CompetitionTeamSearch.aspx?ID=<comp>`) carry
>   each club as a logo `<img title="NAME" ... TeamLogo_<TeamID>.jpg>` in **static** HTML (UTF-8,
>   no browser needed). Parse title+TeamID, dedup `<FEDCODE>:<TeamID>`, iterate competition IDs.
>   PROFILES baked in: **UKR** (`uvf-web`, comps 162-182) + **ALB** (`fshv-web`, comps
>   108/114/115/116/117/122). Override via body `{id,fedcode,dpHost,country,comps:[...]}`.
>   Name-only records (no city/website/contacts yet). **DataProject is used by many feds — reuse
>   for any other CEV/AVC fed whose results live on `*.dataproject.com`.**
> **DB now ~9,220 clubs / 4,564 contacts.**
> **Zero set down to 4 (all marginal):** CYP (`volleyball.org.cy` **compromised** — SEO-spam
> defacement, no club table; need alt domain), GIB (no website/directory — mark resolved-no-source),
> LAT (`volejbols.lv/komandas` ~15 league rosters, name+coach only, low value), MON (Monaco, ~1-2
> clubs). All low ROI — pursue only on request.
> **Still deferred:** SUI full roster (behind authenticated `api.volleyball.ch/indoor/clubs`),
> SWE full roster (Profixio, email-less, browser-only). Both off-zero (partial). Next enrichment
> step for NOR/UKR/ALB name-only clubs: run Resolve (website) + site-scrape (contacts).
>
> _Last updated: 2026-06-07 (round 6 — NOR/UKR/ALB done; DataProject extractor reusable)._
>
> **Club name englishization (2026-06-07):** New `clubs.name_en` field (migration
> `1780655400_clubs_name_en.js`, idempotent; also added live via API). Workflow
> **`englishize-clubs`** (`tGRn12qBELAptDru` | `/webhook/englishize-clubs`, env
> `VITE_N8N_ENGLISHIZE_CLUBS_URL`): finds clubs whose `name` is in a **non-Latin script**
> (deterministic Unicode-range gate) and lacks `name_en`, batches 50→Gemini 2.5 Flash
> (romanize proper nouns + light-translate generic descriptors, keep acronyms transliterated),
> never-crash JSON parse, PATCHes `name_en`. Idempotent; re-run after each non-Latin fed.
> UI: Club column is a two-line cell (romanized over native, like the Country column) +
> "Englishize names" button. Export Club = `name_en || name`. Backfilled the existing non-Latin
> backlog (UKR/RUS/BUL/SRB/GRE Cyrillic+Greek). Also fixed the DataProject extractor to
> HTML-decode names (`&quot;`). Spec: `specs/club-name-englishization.md`.

> **Search-led discovery — "No federation – Google" (2026-06-07):** A second discovery channel
> that finds clubs NOT in any federation directory. Spec: `specs/search-led-discovery.md`.
> Schema (migration `1780655700_search_discovery.js`, **also created live via PB API**, idempotent):
> `clubs.website_source` += `search`; new `search_keywords` collection (keyword registry +
> per-keyword tracking log: status pending/searching/searched/error, results/accepted/new_clubs/
> dup_count); `settings.search_discover` `{enabled,batch_size}` control (paused by default);
> pseudo-federation **GGL** "No federation – Google" (`country='Global'`, id `8j4be811sxpus4t`).
> **Three n8n workflows** (drain→processor split because Serper/Anthropic are credentialed HTTP
> nodes, unusable from a Code node — mirrors scrape-queue-drain→site-scrape-club):
> - `search-keywords-generate` `bqvL9pMe0f2NLxKZ` | `/webhook/search-keywords-generate` (Haiku
>   makes localized club queries → upsert pending rows)
> - `search-keyword-process` `XEHgcX4lPg7KRY8M` | `/webhook/search-keyword-process` (Serper →
>   blocklist + strict deterministic pre-screen → strict Haiku club-classifier → URL-host dedup
>   vs ALL clubs → create under GGL `website_source='search'`/`B`/`needs_review`,
>   `dedup_key='search:<host>'` → enqueue into existing `scrape_queue` → write back counts)
> - `search-discover-drain` (cron, every 2 min) `x4g5G7jbI5wO11Eu` (gated by the settings flag;
>   backpressure on `searching`; stale-retry; dispatches the processor)
> UI: new **Discovery** view (`src/features/discovery/DiscoveryPage.tsx`, in App nav) — keyword
> table (sortable/filter/CSV) + "Generate keywords" (country) + Pause/Resume drain + live stats.
> Dashboard: "No federation (search)" row in By-confederation + a new "How it works" step.
> Clubs list: **Source filter** (incl. "Exclude search discovery (Google)") + sortable **Created**
> column. Contacts: sortable **Created** column. **Reset filters** button on all three lists.
> **Pilot = the two biggest long tails: Italy (was 49 clubs) + Germany (was 163)**, ~20 keywords
> each, drain enabled. Early results: **Italy 42 new clubs / 0 dup, Germany 13 new / 1 dup**
> (URL-dedup confirmed working), ~85 contacts already auto-harvested from the discovered sites;
> precision spot-check excellent (real club .it/.de sites, no federations/news/shops). Drain
> still finishing the remaining keywords. **Tune from the new_clubs-vs-dup numbers before scaling
> to more countries.**

> **Phase 2.6 — resolve-time website enrichment (2026-06-07):** Reworked the `enrich-club`
> resolve (`jOeufPcBBIWrij7M`, **deployed live + export in sync**). New `clubs` fields (migration
> `1780655300_clubs_enrichment.js`, **not yet deployed to prod** — PB silently drops them on PATCH
> until next deploy; workflow is forward-compatible): `website_emails` (json hint), `contact_url`,
> `section_url`, `socials` (json), `site_lang`. Changes: **(A)** harvest emails/contact-link/
> socials/lang from the already-fetched homepage ($0); **(B)** keep canonical root URL + www/http
> probe + `section_url` for deep/volleyball-section links; **(C)** next-best-result fallback across
> the Serper pool when the LLM pick is a hard miss; **(D)** added **Serper Search 2** (broader
> query, no "volleyball") feeding the fallback pool only (Pick still sees the volleyball query →
> precision kept); **recheck** now re-harvests already-resolved clubs. Smoke-tested on BG clubs:
> resolved A + emails/socials/lang harvested, contact_url correct, section_url empty for dedicated
> clubs (correct). Spec: `specs/club-website-enrichment.md`.
> **Overlap decision:** Resolve = cheap producer; the Phase-5 club-site scraper stays the
> authoritative email/contact extractor and should **consume `contact_url`/`section_url`** (wiring
> into `site-scrape-club` is the remaining Phase-5 step — see `club-site-contact-scraper.md`).
> **Next:** deploy the migration; then drive the Clubs-page batch with `recheck=true` over
> `website_status='live'` to backfill enrichment on the existing clubs (log email + A/B/C counts).

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
  - Extract clubs (NVBF klubboversikt/NOR) `3F0l7csD11ihAmMJ` | `/webhook/extract-clubs-nor`
  - Extract clubs (static name list; CYP/LAT) `Nq3ffFPlplikrqRw` | `/webhook/extract-clubs-namelist`
  - Extract clubs (NIF ClubSearch/NOR) `zA8cUjhYy1469qHl` — **pre-existing, no repo export; superseded by extract-clubs-nor (NIF set has no contacts)**
  - Extract clubs (FFVB/FRA) `Vz1NsAbq4JWzwZr8` | `/webhook/extract-clubs-ffvb`
  - Extract clubs (Nevobo/NED) `42Ur1JEWgaQkDZ0a` | `/webhook/extract-clubs-nevobo`
  - Extract clubs (NIF/NOR) `zA8cUjhYy1469qHl` | `/webhook/extract-clubs-nif`
  - Extract clubs (DataProject/UKR,ALB,…) `x0JKgaz4Y2lOSLc9` | `/webhook/extract-clubs-dataproject`
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
