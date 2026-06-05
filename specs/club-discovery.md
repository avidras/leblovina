# Spec: Club discovery & extraction (Phase 2)

Find, per federation, the page(s) that list that country's member volleyball **clubs**,
extract them into the `clubs` collection, and resolve a website for each club. This is the
agentic core of the lead-gen pipeline; contact harvesting is Phase 3.

## Why this is hard (grounded in recon)

We profiled 8 federations across all 5 confederations. The same task ("list this country's
clubs") has wildly different shapes — there is **no single scraper**:

| Federation | Source | Archetype |
|---|---|---|
| Poland (PZPS) | `pzps-rejestracja.pl/klub/getList` — open JSON, 1521 clubs, incl. contacts | **A: open API** |
| Egypt (EGYVBF) | `admin.egyvbf.com/api/clubs` — open JSON, 194 clubs, contacts null | **A: open API** |
| Germany (DVV) | SAMS REST `/api/v2/sportsclubs` (API key) ×~17 Landesverbände + HTML registers | **B: keyed/federated API** |
| Italy (FIPAV) | ~100 committee subdomains, static HTML tables, rich fields, one anti-scrape notice | **C: federated static HTML** |
| Brazil (CBV) | 27 state pages `clubes-<uf>`, Cloudflare/JS, patchy | **D: JS / anti-bot** |
| USA (USAV) | ~40 RVA sites, many on SportsEngine (403 to bots), ~3000 clubs | **D: JS / anti-bot** |
| Turkey (TVF) | authoritative registry **login-gated**; public = XLS + JS widget | **E: gated, public proxy** |
| Japan (JVA) | MRS **login-gated**; fallback = 47 prefecture HTML/PDF | **F: gated / no clean path** |

Two structural facts: **81/218 federations have no `website_url`**, and most large
federations are **federated** — clubs live in 17–100 *regional* sub-directories, not one list.

## Entities (end-to-end)

```
federations ──1:N──> clubs ──1:N──> contacts
 (Phase 1 ✓)    (Phase 2, this    (Phase 3 — verified A/B
  seed           spec: the club    emails, the EXPORTED product)
                 + its website)
```

`contacts` is the **terminal/product entity** (exported to Brevo). `clubs` is the bridge:
its job is to yield each club's website so Phase 3 can harvest contacts. Directory info
(the club-list page[s]) is stored as JSON on `federations`, not a separate collection.

## Decisions (interactive Q&A)

1. **Europe first, then priority-tier waves.** **European (CEV) clubs are the #1 priority** —
   Wave 1 targets CEV federations. Overall order still follows the domain rule
   Europe → ME/Asia → US → LatAm, sub-sequenced by extraction difficulty:
   - **Wave 1** — CEV, easiest sources first (open APIs + clean static HTML: Poland, Italy,
     Germany, …). This is where we prove the pipeline and bank the highest-value clubs.
   - **Wave 2** — remaining CEV + other confederations' JS/anti-bot sources (Firecrawl → Apify).
   - **Wave 3** — search-discovery for the 81 no-site federations (Serper).
   - **Long tail** — login-gated / no-directory → `needs_review` queue.
2. **Orchestration: n8n AI Agent node** (Claude) with tools `[Serper, Firecrawl, Apify, HTTP, PB]`.
   Consistent with "scraping lives in n8n"; UI triggers it; PB realtime streams results.
3. **Tooling: Firecrawl + Apify, tiered.** Firecrawl = default (JS render + LLM `/extract`);
   Apify = escalation for Cloudflare/SportsEngine anti-bot + residential proxies; Serper =
   discovery + the no-site gap-fill; plain HTTP = clean APIs; Claude = classify/extract brain.
4. **Club identity: computed `dedup_key`** — source's own club id when present
   (`<fed>:<sourceClubId>`), else `<fed>:<slug(name)>:<slug(city)>`. One unique index; works
   for website-less clubs; idempotent reruns.
5. **Discovery gate — UI-controlled policy.** The gate is *not* hardcoded in the workflow; it
   reads a policy from PocketBase that the UI sets, so behaviour is changeable without editing
   n8n. Policy modes (global default, with optional per-federation override):
   - `review_all` — discovery always parks at `needs_review`; nothing extracts without a human.
   - `auto_safe` *(default)* — clean tiers (open API, simple static HTML) auto-extract;
     risky ones (JS/anti-bot, ambiguous, anti-scrape notice) → `needs_review`.
   - `auto_all` — extract everything discovered, no gate (fastest, least oversight).
   Stored in a small **`settings`** key/value collection (`extraction_gate` = mode); an
   optional `federations.gate_override` (`default | always_review | always_auto`) flips
   individual federations. The discovery workflow reads these before deciding extract-now vs
   `needs_review`; the UI exposes both controls + a review-queue "Approve & extract".
6. **Serper club-URL resolution** — when a club row has no website, google it and resolve one
   (validated), so Phase 3 has a site to harvest contacts from.

## Architecture — two stages per federation

**Stage 1 — Discover & classify** (writes onto the `federations` row). Discovery is
**search-led, not crawl-led** — the club registry is usually *not* on the federation's own
domain (Poland → `pzps-rejestracja.pl`, Germany → `*.sams-server.de`, Egypt → `egyvbf.com`,
Italy → ~100 `*.federvolley.it` subdomains), so blindly crawling `website_url` finds nothing.
Order of attack:
- **Serper** targeted search + `site:` operator (`"<country> volleyball clubs list"`,
  `site:<fed-domain> società/clubs/vereine`) — often lands directly on the directory or the
  external registry.
- **Firecrawl `/map`** — fast URL inventory of a candidate domain; scan anchor texts for
  directory keywords. (Cheap; NOT a deep `/crawl`.)
- **Known-platform pattern probing** — SAMS REST, common registry subdomains, `/clubs`,
  `clubes-<uf>`.
- **LLM ranks** the candidates and confirms by fetching one. Firecrawl `/crawl` (deep) is a
  last-resort fallback only.
- Detects federated structure and enumerates the per-region sub-directory URLs.
- Writes `club_directory_url` (primary/index) and `directory_urls` (json — one entry per
  club-list page: `{ url, region, extraction_method }`, where `extraction_method ∈
  static | js | api_endpoint | pdf | none`). **`extraction_method` is per directory entry**,
  not per club; `federations.extraction_method` holds the dominant/summary value.
- Sets `federations.status`: `scraped` (ready to extract) or `needs_review` (gated/ambiguous/
  ToS-flagged/no directory).

**Stage 2 — Extract clubs** (tiered, cheapest first → writes `clubs`):
- `api_endpoint` → plain HTTP GET + map (Poland, Egypt) — free, deterministic.
- `static` → fetch + parse; Firecrawl `/extract` with the club schema for messy HTML.
- `js` / anti-bot → Firecrawl (JS render) → **escalate to Apify** (proxies/stealth) on 403/empty.
- `pdf` / `xls` → download + parse.
- `none` / `login` → `needs_review`; never bypass auth or explicit anti-scraping notices.
- Each extracted club is upserted by `dedup_key` (find-or-create, same pattern as federations).

**Stage 3 — Club website enrich (validate + resolve).** A distinct enrichment that runs on the
`clubs` table **after extraction, before Phase 3** (you can't harvest contacts without a live
site). Triggered as an **async batch from the Clubs page** over the current filter (like
"Process N"), so the Serper spend is gated/re-runnable. Per club, in order:
1. **Validate** (cheap HTTP, no LLM/Serper) — if the club has a `website_url`, HTTP GET/HEAD it.
   2xx/3xx → `website_status = live`. 404/unreachable/DNS-fail → `website_status = dead`, clear
   the URL + `website_source = none`. (Also catches dead official-list URLs.)
2. **Resolve** (Serper) — only for clubs with no live website (originally missing or just
   invalidated). Query `"<club name>" <city> <country> volleyball`; validate the top candidate
   (name-token overlap; reject aggregators/social/Wikipedia/league pages + the federation's own
   domain) AND that it responds (HTTP). Found → `website_url` + `website_source = serper` +
   `website_status = live`. Nothing credible → `website_status = not_found` (the club likely has
   no website). Never invent a URL.

`website_status` ∈ `unknown | live | dead | not_found` lets the UI filter and stops us
re-resolving known-dead/not_found clubs. Validation is cheap (can run freely); resolution is
the cost to gate.

## `clubs` collection (migration)

| field            | type     | notes |
|------------------|----------|-------|
| federation       | relation | → `federations` (the source federation) |
| name             | text     | required |
| country          | text     | denormalized from federation for export/filtering |
| region           | text     | state / Land / committee / RVA / prefecture |
| city             | text     | |
| website_url      | url      | may be empty until Stage 3 resolves it |
| website_source   | select   | `official_list / serper / manual / none` (provenance of the URL) |
| website_status   | select   | `unknown / live / dead / not_found` (Stage 3 validate+resolve outcome) |
| source_url       | url      | the directory page this club was scraped from (provenance) |
| source_club_id   | text     | source's own id/code if any (Italy codice, PB id, …) |
| dedup_key        | text     | **required, unique** — see decision 4 |
| status           | select   | `new / contacts_found / no_contacts / error / needs_review` (club-level, Phase 3) |
| last_scraped     | date     | |
| notes            | text     | |

Unique index on `dedup_key`. Non-unique index on `website_url` for later contact joins.
`federations` gains a `directory_urls` (json) field for enumerated sub-directories, plus a
`gate_override` (`default | always_review | always_auto`) for per-federation gate control.

**`settings` collection** (config, not an entity): `key` (text, unique) + `value` (json).
Holds UI-controllable knobs read by the workflow — notably `extraction_gate`
(`review_all | auto_safe | auto_all`). Future knobs (active waves, credit caps) live here too.

## n8n AI Agent design

- **Trigger:** webhook, one federation per call (`fivb_code` / record id in body) + a batch
  driver that feeds a wave's federations (UI "Discover clubs" button; per-row re-run).
- **Agent (Claude):** system prompt = the archetypes + tiering rules + ToS guardrails. Tools:
  - `serper_search` — discovery + club-URL resolution.
  - `firecrawl_scrape` / `firecrawl_extract` — crawl + schema extraction.
  - `apify_run` — anti-bot/proxy escalation actor.
  - `http_get` — clean APIs / static pages.
  - `pb_find_or_create_club` / `pb_update_federation` — writes (find-or-create on `dedup_key`).
- **Model:** Sonnet for routine classify/extract; escalate to Opus for hard discovery.
  Keep deterministic fast-paths (known API patterns) out of the LLM loop to save tokens.
- **Guardrails:** per-run page/credit caps; respect `robots.txt` + ToS; honor anti-scrape
  notices (→ `needs_review`); rate-limit; identifiable User-Agent; the gate (decision 5)
  bounds spend. Log what was skipped/capped (no silent truncation).

## Cost & ToS posture

- Tiering means clean federations cost ~$0 (HTTP only); Firecrawl/Apify spent only where
  needed; Serper calls bounded per club. The review gate prevents runaway credit burn.
- Public listings only. No login bypass, no captcha solving, no scraping past explicit
  prohibitions — those federations go to the review queue for a human/commercial-data call.

## Out of scope (Phase 3+)

- Harvesting & verifying **emails/contacts** from each club's site (Apify + MX/verifier) and
  A/B/C quality — Phase 3, keyed off `clubs.website_url`.
- Brevo export. Advanced UI filtering/export.

## UI (part of this phase)

The UI is built **alongside** the workflow this phase (parallelizable) — it's also our debug
harness: trigger the workflow **per federation, manually, by a button**, then inspect results.

- **Federations page** — filterable/sortable table (confederation, country, status,
  extraction_method, last_scraped). Per-row **"Discover clubs"** button → POSTs the discovery
  webhook for that one federation (`fivb_code`). Detail view shows discovered
  `club_directory_url` / `directory_urls` and lets you edit/approve them.
- **Clubs page** — table of clubs, filter/sort/search (federation, country, region, status,
  has-website), inline edit, and a **"Resolve website"** / **"Find contacts"** action per club.
- **Gate control** — a global **extraction-gate** selector (`review_all / auto_safe / auto_all`,
  written to the `settings` collection) plus a per-federation override in the table. This is how
  the decision gate is driven — no n8n edits needed to change behaviour.
- **Review queue** — federations/clubs in `needs_review`, with one-click approve → triggers
  extraction.
- Generic capabilities across pages: search, sort, pagination, row detail, edit, and
  manual workflow-trigger buttons. Live updates via PocketBase realtime during a run.
- Built on the existing single-container app (React + shadcn; PB serves it). Buttons POST to
  the n8n webhooks held in `VITE_N8N_*` env vars (never hardcoded).

Debug-first: in the beginning we drive everything one federation at a time from these buttons
before any batch/wave automation.

## Build order

1. **Migrations:** `clubs` (incl. `dedup_key` unique) + `federations.directory_urls` (json) +
   `federations.gate_override` + `settings` (key/value, seeded `extraction_gate=auto_safe`);
   sync CLAUDE.md.
2. **UI track (parallel):** login; federations table + per-row "Discover clubs" trigger +
   per-row gate override; clubs table; global gate selector; review queue; search/sort/detail/
   edit; realtime. This is the manual debug harness.
3. **Workflow track (parallel):** Wave-1 n8n discovery+extract for CEV open-API/static
   federations (prove Poland, Italy, Germany end-to-end into `clubs`), triggered per-federation
   from the UI button.
4. Firecrawl/Apify tiers (Wave 2) + Serper discovery (Wave 3) + Serper club-URL resolution.
