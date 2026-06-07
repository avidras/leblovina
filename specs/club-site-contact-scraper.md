# Spec: Club-site contact scraper (Phase 5 — the headline deliverable)

The product is export-ready contacts. Directory contacts (done) are opportunistic pre-data;
**most clubs' real contacts live only on their own websites.** This crawls each club's site and
extracts legitimate contacts into `contacts` (`source_type='club_site'`, `unverified`).

## Dependencies
- **Resolve relevance (Phase 1 — done):** garbage URL in → garbage contacts out. Only crawl
  clubs whose `website_url` is a *correctly* resolved, live site.
- **The "URL → contacts" primitive (Phase 2.2 — done):** same fetch→LLM-extract→upsert logic;
  the scraper adds a **crawl layer** (which pages to fetch) on top.
- **Apify anti-bot tier (Phase 4):** escalation for JS/cloaked sites.

## Decisions (confirmed)
1. **Crawl: targeted + Apify escalation.** Fetch the homepage, find contact-relevant links and
   follow up to a small budget; escalate to Apify only when the site is JS-rendered or
   anti-bot. Lowest cost, focused.
2. **Scope: all clubs with a live website** (`website_status='live'`), incl. those that already
   have directory contacts (find more/better). **Email-dedup** (global unique) prevents
   duplicates. **Europe (CEV) first.**
3. **Form-only clubs → skip** (email is required; domain rule #1). If no real email is on the
   site, store nothing and set the club `no_contacts` (revisit form-only in a later phase).

## Consume Resolve's enrichment signals (producer → consumer)

Resolve now harvests directional signals for free on every resolve (see
[`club-website-enrichment.md`](./club-website-enrichment.md)). This scraper is the
**authoritative** email/contact extractor; Resolve is the cheap producer. **Seed page
discovery from these fields before generic crawling:**
- `clubs.contact_url` — fetch first (the best contact/impressum page already found).
- `clubs.section_url` — for multisport clubs, the volleyball-section page (target it, not the
  generic club office).
- `clubs.website_emails` — a **non-authoritative homepage hint**; use to corroborate, but this
  scraper's de-noised `contacts` supersede it.

(Status: the signals are produced & deployed; wiring `site-scrape-club` to read them is the
remaining Phase-5 step.)

## How it works (per club)
1. **Page discovery (targeted).** Start from `clubs.contact_url` / `clubs.section_url` when
   present (above). Then fetch the homepage (plain HTTP first, browser UA) and find
   contact-relevant links — **multilingual**: `contact|kontakt|kontakti|contatti|contacto|
   contact-us|impressum|imprint|o-nas|onas|about|about-us|team|tym|vedeni|upravni-odbor|
   coaches|klub|verein|sobre|equipe|squadra|contatti` — plus footer/header `mailto:` and
   `tel:`. Fetch up to a **page budget = homepage + ≤4 candidate pages**.
2. **Escalate to Apify (Phase 4)** when the homepage is JS-rendered (empty/again-spam markdown)
   or blocked — re-fetch via Apify residential proxies. Otherwise plain HTTP / Firecrawl.
3. **Extract (URL→contacts primitive, Gemini 2.5 Flash).** Deterministic email capture
   (regex) + LLM associates name/position/phone with each email ("President — J. Novák —
   jan@klub.cz"). **Domain rule #1: never invent/guess an email.**
4. **De-noise (critical, the contacts analogue of Resolve relevance).** Drop: the web
   designer's / hosting / CMS-boilerplate emails, social-widget addresses, `example@`,
   `sentry@`, `wordpress@`, and **third-party domains**. **Prefer emails on the club's own
   domain** (or a common free provider tied to the club). Cap obviously-spammy bulk lists.
   - **Agency / web-dev / media noise (two layers).** Footer credits ("realizacja",
     "wykonanie", "projekt i wykonanie strony", "created by", "powered by", "site by",
     "webdesign") attach the *site builder's* email, which is never a club contact — the
     extractor prompt is told to drop these even when a person is named beside them, and to
     drop a named person's email when it sits on an outside company/agency domain rather than
     the club's own. Backed by a **deterministic filter** in Write: a curated noise-domain
     denylist (e.g. `otagomedia.pl`, `iproart.com`) + a conservative agency-keyword regex on
     the email domain (`agencja|interaktyw|interactive|webstudio|webdesign|webdev|…`). The
     denylist is easy to extend as new offenders surface. Keep keywords specific so a club's
     own `marketing@`/`media@` on its own domain is never dropped. Validated on the POL sample
     (round 7): caught `otagomedia.pl`, `iproart.com`.
5. **Write incrementally, per club** (the 21-min all-or-nothing harvest lesson): upsert each
   club's contacts as found (find-or-create by email; `source_type='club_site'`,
   `source_url`=the page). Set club `contacts_found` / `no_contacts`; stamp `last_scraped`.

## Orchestration (must scale — thousands of clubs)
The detail harvester took ~21 min for one 139-club federation **sequentially** — far too slow
for the continent. The site scraper must:
- **Driver** pages through `website_status='live'` clubs, **Europe-first**, in batches with
  **bounded concurrency** (parallel club workers, capped to respect Gemini + Apify limits).
- **Per-club worker** is async, **`onError:continue`** (a failed club is logged, never aborts),
  **retry-with-backoff** on 429s, and **writes incrementally**.
- **Idempotent / resumable:** skip clubs already site-scraped (a `club_site`-sourced contact or
  a `last_scraped` marker) unless `force`; a re-run resumes where it left off and converges.
- **No giant sync executions** (they hit n8n's execution timeout and lose work).

## Data
- Contacts: `source_type='club_site'`, `verification_status='unverified'`, `source_url`=page.
- Club: `status` → `contacts_found` (≥1 email) / `no_contacts`; `last_scraped` stamped.
- Quality (Phase 3+): contact directness (named coach > generic `info@` > none) feeds A/B/C
  later — not scored here.

## n8n shape
`site-scrape-driver` (webhook, async): list live-website clubs (filterable by confederation /
not-yet-scraped) → batch → fire `site-scrape-club` workers (bounded concurrency). `
site-scrape-club` (webhook): homepage fetch → discover candidate links → fetch candidates
(Apify-escalate if needed) → Gemini extract+de-noise → upsert contacts → set club status.
Reuses the Anthropic/Gemini + PB-admin + Apify creds.

### Worker improvements (resolver-aware) — A–G

The worker (`site-scrape-club`) now exploits the resolver's signals on the club row instead of
rediscovering everything:

- **A — seed candidates from `contact_url` + `section_url`.** The resolver's best contact page is
  used as a guaranteed candidate (ahead of the markdown/HTML keyword rediscovery), so the page
  budget is spent on the best pages even when the homepage render misses the link.
- **B — confidence gate (C is ALWAYS excluded).** The worker **never page-scrapes a
  `website_confidence='C'` club's website — not even with `force`** (`useSite = home &&
  conf!=='C'`). C is where wrong-club/aggregator URLs land — the POL sample (round 7) confirmed
  ~50% of C sites are the wrong entity (town-hall/school/news inboxes like `sekretariat@czosnow.pl`,
  `info@chojna.pl`). Three layers enforce this: the **driver's** default full-run filter excludes
  C (`website_status='live' && website_confidence!='C'`), the **UI** scrape action filters to A/B,
  and the **worker** guard is the absolute backstop. `force` now only re-scrapes already-done A/B
  clubs; it can no longer override the C exclusion. (A C-confidence club with a `detail_url` is
  still scrapable via that federation page — the exclusion is about its dubious *website*, not
  federation-provenance pages.)
- **C — `website_emails` fallback.** Any deterministically-harvested homepage email not captured
  by the LLM is still written (email-only contact), so a missed LLM extraction never loses real
  emails / falsely marks `no_contacts`. (Domain rule #1 safe — extracted, not guessed.)
- **D — multisport-aware.** For `club_type='multisport'`, `section_url` is prioritized and the
  extractor is told to take **only the volleyball section's** contacts, not other departments.
- **E — plain-HTTP-first, Firecrawl-escalation.** A `Fetch home` step pulls the homepage over
  plain HTTP; an IF (`needsRender`) routes to **Firecrawl only when the plain fetch is empty/JS-
  shell**. Most static club sites no longer cost a Firecrawl render. Graph:
  `Get club → Fetch home → (needsRender?) → [Firecrawl home] → Crawl → Extract → Write`.
- **F — page budget 2 → 4** candidate pages (seeded best-first).
- **G — per-contact `source_url`.** Pages are fed with `=== URL ===` markers and the extractor
  returns the `source` page per email; `Write` stores it (falls back to homepage). Provenance
  per contact (domain rule #4).

### H — federation detail pages (`detail_url`)

Many clubs have a `detail_url` (the federation's per-club listing page) — **~2,056 clubs, of
which ~1,062 have no website at all**. These pages carry the club's contact (email/phone/
president). The scraper now uses them:
- **No website → `detail_url` is the source** (unblocks the ~1,062 site-less clubs).
- **Has website → also fetch `detail_url`** and merge it into the same extraction pass.
- **De-noise:** the detail section is labelled `(FEDERATION DIRECTORY PAGE …)` and the extractor
  is told to take **this club's** contact while **excluding the federation's own boilerplate**
  emails (office@/press@/marketing@/website@/social@, typically on the federation's own domain).
  (Sample `bvf.bg/club/138` exposes the club email `…@abv.bg` alongside ~6 `@bvf.bg` federation
  addresses — only the former is wanted.)
- **Provenance:** detail-page contacts are written `source_type='directory'` (federation
  listing); website contacts stay `club_site` — decided per contact via the extractor's `source`
  URL (host == the detail page's host ⇒ `directory`).
- **Gate:** the C-confidence gate applies to *websites*; a `detail_url` is federation-provenance,
  so a club is scraped whenever it has any usable source (A/B site **or** a detail page). The
  deterministic `website_emails` fallback is website-only (not applied to detail pages — too
  noisy with federation boilerplate; the LLM handles detail pages).
- **UI:** "Full site scrape" includes every club with a `detail_url` (plus A/B live sites).

### Driver inputs / UI trigger
`site-scrape-driver` webhook body:
- `ids: string[]` — explicit club ids to scrape (used by the UI; scopes to exactly these).
- `onlyNew: true` — when no `ids`, skip clubs already scraped (`contacts_found`/`no_contacts`).
- `limit: N` — cap the number processed.

When `ids` is present the driver scrapes exactly those (ignores the global `website_status='live'`
query); otherwise it self-selects all live clubs. **UI:** the Clubs page **"Scrape sites for
contacts"** action (in the batch actions menu) fetches the ids of live clubs in the *current
filter* and POSTs them as `{ids}` (env `VITE_N8N_SITE_SCRAPE_URL`) — so the team can scope a run
by confederation/country/etc., mirroring the resolve/harvest buttons. Heavier than resolve
(multi-page + Apify/Gemini) and writes to `contacts`, so it's confirm-gated.

## Out of scope (later phases)
Email **verification** (MX/SMTP), **A/B/C quality**, **Brevo** push, export shape. Form-only
clubs (no email) deferred.
