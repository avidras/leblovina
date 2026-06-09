# Search-led club discovery ("No federation – Google")

> **See also `## Generalization (v2)` near the end** — the discovery queue is being reframed into
> a generic, **target-driven** "search & fill" engine (per-keyword `target` = which collection it
> fills; manual single-keyword entry; opt-in generator with a pick-which-to-queue step). The
> club flow below is `target='clubs'`, the first/default target.

## Goal

Find volleyball clubs that are **not in any federation directory** by searching the open web.
Federation-led discovery only surfaces registered/listed clubs; many real clubs (academies,
beach/recreational/university clubs, and clubs whose federation has no usable directory) are
only findable via search. This adds a second discovery channel — keyword → web search →
strict classification → URL-dedup → create + scrape for contacts — reusing the primitives we
already have (Serper, the belongs/relevance classifier from `enrich-club`, the site-scrape
queue, the dedup conventions).

## Decisions (agreed)

1. **Dedup = URL only.** A candidate is a duplicate iff its site's host matches an existing
   club's `website_url` host. No name/city fuzzy matching (accepted: a search hit for a club
   that we hold *without* a website will create a new record — known, tolerated).
2. **Classifier must be very strict.** Better to drop a real club than admit a federation /
   league / news / shop / aggregator / social page. Discovery is harder than Resolve because
   there's no known club name to match against — the page alone must prove "a volleyball club's
   own site".
3. **Server cost is not a constraint** — keyword volume can be generous; still bounded per tick
   for stability, not cost.
4. **Provenance/tagging.** New clubs: `website_source='search'`, `status='needs_review'`, under
   a pseudo-federation so they're segregated for vetting/export.
5. **Pseudo-federation "No federation – Google"** holds all search-discovered clubs.
6. **Targeted + piloted.** Aim at under-covered geographies (the long tail where directories
   fail); pilot on 1–2 countries and read the new-vs-dup numbers before scaling.

## Schema

### `search_keywords` collection (registry + tracking log; mirrors `scrape_queue`)
| field | type | notes |
|-------|------|-------|
| keyword | text | the search query — **unique** (re-generation is idempotent) |
| country | text | target country |
| lang | text | language of the term |
| status | select | `pending` / `searching` (dispatched, in-flight) / `searched` / `error` |
| searched_at | date | when the processor ran it |
| results_count | number | organic results Serper returned |
| accepted_count | number | results the classifier judged real club sites |
| new_clubs | number | net-new clubs created (after URL dedup) |
| dup_count | number | accepted sites whose host already existed → skipped |
| attempts | number | dispatch attempts (drain backpressure / stale-retry) |
| notes | text | errors / detail |
| created / updated | autodate | |
Indexes: unique on `keyword`, index on `status`.

### `settings.search_discover` control row
`{ enabled: bool, batch_size: number }` — same Pause/Clear/cap model as `scrape_drain`.

### Pseudo-federation seed
One `federations` record: `fivb_code='GGL'`, `name='No federation – Google'`,
`country='Global'` (the `country` field is required), `confederation=''` (treated as its own
group on the dashboard). Search-discovered clubs set `federation` = this record. Live id:
`8j4be811sxpus4t`.

### `clubs` reuse
- `website_source` gains a value **`search`** (enum update: migration + `pb.ts` `WebsiteSource`).
- New club: `{ federation: GGL, name, country, city, website_url, website_source:'search',
  website_status:'live', website_confidence:'A', club_type:'volleyball'|'multisport',
  status:'needs_review', dedup_key:'search:<host>' }`. **Confidence `A`** — the strict classifier
  only accepts a confirmed single real volleyball-club's own site (anything ambiguous is rejected),
  so an accepted match is trusted, not merely probable. `club_type` comes from the classifier
  (LLM, judged by what the **website** is about — **biased to `volleyball`** for any
  volleyball-focused site incl. a larger Verein's volleyball section/Abteilung that has its own
  site; `multisport` only for a genuine multi-sport portal. A crude regex over-called multisport
  on German section sites, so type is the LLM's call, not a keyword match). `status='needs_review'` is the
  human-vetting gate (orthogonal to confidence).

## Workflows (n8n) — as built

> **Three workflows, not two.** Serper and Anthropic are n8n *credentialed HTTP nodes* and
> cannot be called from a Code node (only PB, via its auth token, can). So — exactly like
> `scrape-queue-drain → site-scrape-club` — the cron **dispatches** each keyword to a
> per-keyword **processor** workflow that owns the Serper + classifier HTTP nodes. The drain
> itself is Code-only (PB + the dispatch webhook).

Live ids (deployed + exports under `n8n/`, kept in sync):
- `search-keywords-generate` `bqvL9pMe0f2NLxKZ` | `/webhook/search-keywords-generate`
- `search-keyword-process`  `XEHgcX4lPg7KRY8M` | `/webhook/search-keyword-process`
- `search-discover-drain` (cron) `x4g5G7jbI5wO11Eu` (every 2 min; gated by the settings flag)

### Generate — `search-keywords-generate` (webhook)
Body `{ country, cities?, count? }`. Anthropic Haiku produces localized keywords for the
country: the volleyball term in the local language(s) (pallavolo/Volleyball/siatkówka/voleibol/…)
× {club, società, Verein, klub, academy, youth, asd} × a city/region list (LLM-supplied top
cities, or passed in). Upserts `pending` rows into `search_keywords` (unique `keyword` ⇒ no
dupes — re-runs are idempotent). Bounded `count` (~40 default).

### Drain — `search-discover-drain` (Schedule Trigger every 2 min, mirrors `scrape-queue-drain`)
Code-only. Each tick:
1. Read `settings.search_discover`; if `enabled!==true` → stop (Pause).
2. Reconcile: rows still `searching` past `stale_minutes` (lost their callback) → back to
   `pending` (retry), or `error` after 3 attempts. In-flight = count of `searching`.
3. Backpressure: top up to `batch_size`; mark each picked `pending` row `searching`
   (`attempts++`) and POST it (`{id}`) to `search-keyword-process` (fire-and-forget, 15 s
   timeout — the processor keeps running server-side and writes the row back itself).

### Processor — `search-keyword-process` (webhook, one keyword per call)
1. Get the `search_keywords` row.
2. **Serper** search (organic, `num:100` — all available results for the keyword, not just the
   first page; Google returns fewer for niche queries, which is fine).
3. **Prepare candidates** (Code): blocklist-filter hosts (social, news, wiki/fandom, FIVB/CEV/
   federation, results platforms — dataproject/sofascore/flashscore…, retail/marketplace,
   ticketing, maps, gov, video, blog platforms); dedup by host; fetch each homepage (plain
   HTTP, cap 40, **in parallel chunks of 10**); **strict deterministic pre-screen** — must show
   a volleyball signal and not be parked/for-sale; collect title/og:site_name/h1/excerpt signals.
4. **Strict classifier** (Anthropic Haiku, one call for all candidates): *is this the official
   site of a SINGLE real volleyball CLUB?* Reject federations, leagues/results/stats,
   news/blogs, shops, directories/portals, schools-without-a-club, arenas/municipality,
   ticketing, anything ambiguous — conservative, "no" when unsure. Returns per-host
   `{is_club, name, city}`.
5. **URL dedup:** normalize host (strip scheme/www, lowercase). If any existing club's
   `website_url` host matches → `dup_count++`, skip. Else create the club (fields above) with
   `dedup_key='search:<host>'` (the unique index also blocks search-vs-search dupes) and enqueue
   it into the **existing `scrape_queue`** for contact harvesting.
6. Write back the keyword row: `status='searched'`, `searched_at`, `results_count`,
   `accepted_count`, `new_clubs`, `dup_count`. Errors leave it `searching` → the drain retries.

Reuses: Serper + Anthropic credentials, the `enrich-club` belongs/harvest heuristics, the
site-scrape queue + worker, and the dedup/host helpers. Pause via the settings flag.

## UI / Dashboard
- Search-discovered clubs appear naturally in the Clubs list (filter `website_source='search'`
  or federation = "No federation – Google") and the Federations list (one row + club count).
- **Dashboard "By confederation":** add a row for the pseudo-federation (label "No federation
  (search)") so its clubs/contacts are counted there (its `confederation` is blank).
- Optional later: a small "Search discovery" panel (keywords pending/searched, new clubs found)
  mirroring the scrape-queue panel.

### Discovery view (built) — `src/features/discovery/DiscoveryPage.tsx`
A dedicated **Discovery** nav tab: a keyword table (sortable/filterable by country+status, CSV
export), a **Generate keywords** control (country + count → `search-keywords-generate`), and a
**Pause/Resume** control + live stats for the drain (`settings.search_discover`). **Re-search**:
a per-row action and a bulk "Re-search filtered (N)" action reset keyword(s) to `pending` so the
drain runs them again (dedup makes reruns idempotent — re-found hosts count as `dup`). Filter
selects show a subtle blue tint when set to a non-default value (a shared `Select active` prop,
applied across all list filter panels).

## Pilot & success criteria
Pilot countries = the **two biggest long tails** (largest gap between real club population and
our coverage): **Italy** (49 clubs vs thousands real) and **Germany** (163 vs thousands) — both
huge volleyball nations whose directories only partially yielded. ~20 keywords each.
Read per-keyword `new_clubs` vs `dup_count` and spot-check the created clubs for precision (are
they really clubs?). Decide scale + tune the classifier/keywords from the numbers. Expect: in
covered countries mostly dups; in the tail, meaningful net-new.

**First smoke test (Italy, keyword "pallavolo club Roma sito ufficiale"):** 10 organic →
6 candidates (post blocklist/pre-screen) → 5 accepted → **5 net-new clubs**, 0 dups; all 5
were real Roman clubs on their own `.it` sites (Invicta Roma Volley, Roman Volley, Diamond
Roma Pallavolo, …) tagged `B`/`needs_review` and enqueued for contact scraping. Precision good.

## Out of scope
- Name/fuzzy dedup (URL-only by decision) and merging search clubs into existing directory
  clubs that lack a URL (possible later reconciliation).
- Auto-promoting search clubs out of `needs_review` (manual vetting first).
- Verifying contacts (handled by the existing Phase-3 verifier later).

---

## Generalization (v2) — a target-driven "search & fill" engine — DESIGN

> **Status: DESIGN.** Reframes the discovery queue from a single hardcoded club flow into a
> generic keyword engine. Decided via questionnaire. Build now with `target='clubs'`; the
> `tournaments` target lights up when `specs/tournament-led-discovery.md`'s processor lands.

### Concept
Today: *enter a country → it generates club keywords → they auto-queue → scrape clubs.* One
shape. v2 makes the queue abstract: **each keyword carries a `target`** = which collection/entity
it fills. The drain stays target-agnostic; the **processor branches on `target`**. Adding a new
discovery flow later = a new target + a processor branch, nothing else.

### Decisions (agreed)
1. **Per-keyword `target`.** Enum `clubs` (default/current) → later `tournaments`. The Discovery
   table gains a Target column + filter.
2. **Two ways to add keywords:**
   - **Manual single keyword** — `{ keyword, target, country? }` → one `pending` row. (`country`
     required when `target='clubs'` — the club classifier/labels need it; optional otherwise.)
   - **Opt-in generator** — the user explicitly chooses to generate, picks a `target` + context
     (clubs → country + count; tournaments → region/level + count, later), gets candidates back.
3. **Generator = show & pick, save only chosen.** Generation **returns candidate keywords to the
   UI without persisting them**. The user sees a checkbox list (all pre-checked), unticks the
   unwanted, confirms → only the chosen rows are created as `pending`. No "draft" clutter.
4. **Scope now:** ship the framework with `target='clubs'` working; expose `tournaments` in the
   target picker only once its processor exists.

### Schema
- `search_keywords` gains **`target`** (select: `clubs` | `tournaments`, default `clubs`;
  existing rows backfill to `clubs`). Keep the collection name (a rename is invasive); `pb.ts`
  `SearchKeyword` gains `target` (+ a `SearchTarget` type). `country` stays (per-target optional).
  Generic counters (`results_count`/`accepted_count`/`new_clubs`/`dup_count`) are reused; the UI
  relabels them per target (e.g. `new_clubs` → "found" for tournaments).

### Workflow changes
- **`search-keywords-generate` becomes a pure candidate generator**: body `{ target, country?,
  count? }` → **returns** `{ candidates: [{ keyword, lang }] }` (no DB writes). Branches the prompt
  by `target` (clubs = the current city×club-term prompt; tournaments = tournament-name queries,
  added with that route).
- **Enqueue is client-side** (the UI is superuser-authed, as it already is for re-search): on
  confirm, the UI `create()`s the chosen `search_keywords` rows (`status='pending'`, with `target`
  + `country` + `lang`), catching the unique-`keyword` conflict as "already queued". Manual single
  add uses the same client create. No new webhook needed.
- **`search-discover-drain`** unchanged (dispatches any `pending` keyword regardless of target).
- **`search-keyword-process` branches on `target`:** `clubs` → today's logic; `tournaments` →
  the tournament processor logic (creates a `tournaments` row, finds participants, etc. — see the
  tournament spec). The drain→processor split and Pause/stale-retry are shared.

### UI (`DiscoveryPage.tsx`)
- Replace the single "Generate keywords" bar with an **"Add keywords"** area with two modes:
  - **Add one** — keyword input + `target` select + `country` (shown/required per target) → create.
  - **Generate** — `target` + context + count → "Generate" → a **selectable candidate list**
    (checkboxes, "Select all", a count) → "Add N selected" → client-creates the chosen `pending`
    rows. Candidates live only in component state until added.
- Table: add a **Target** column + a target filter; keep the existing status/country filters,
  sorting, CSV, Pause/Resume, per-row + bulk re-search.

### Reconciliation with the tournament route
The tournament spec's "`tournaments` collection doubles as the keyword registry" is **superseded**:
tournament **keywords live in this unified queue** (`target='tournaments'`); the `tournaments`
collection holds the **discovered tournament entities** the processor creates. The tournament
spec's `tournament-add` webhook is replaced by **manual single-keyword add with
`target='tournaments'`** (+ the opt-in generator). See `specs/tournament-led-discovery.md`.

### Out of scope (v2)
- The `tournaments` processor branch itself (separate spec/build).
- Per-target generator context beyond country (e.g. tournament level/age-group) — lands with the
  tournament route.
- Persisting/curating generated candidates as drafts (explicitly rejected — transient by decision).

## Broad keyword generation + pagination (v3)

Two breadth modes for club keyword generation, chosen in the Add-keywords bar:

- **Per-city (specific)** — the original: volleyball-term × club-words × major cities →
  precise queries that surface a single club's own site. High precision, lower recall.
- **Broad** — input is **Country + optional Focus** (e.g. "Germany" + "youth clubs"). The
  generator (`search-keywords-generate` → "Build prompt", `breadth='broad'`) produces
  high-recall, NOT-city-bound localized queries (club/Verein/klub words, youth/level words,
  list/directory words, broad regions). Favours recall over precision.

**Pagination.** Serper's `/search` ignores `num` and returns **max 10 results per request**
(verified) — more requires the `page` param. So each keyword carries a `pages` field
(`search_keywords.pages`, 1–5): broad keywords are created with `pages=3` (~30 deduped
results), per-city/manual keywords stay at `1`. The processor (`search-keyword-process`) has a
**Pages** node that fans out `1..pages`; the Serper node runs once per page; "Prepare
candidates" combines + de-dupes organic across pages by link.

Cost: a broad keyword ≈ 3× the Serper calls of a specific one — which is why pagination is
opt-in per keyword (broad only), not global.
