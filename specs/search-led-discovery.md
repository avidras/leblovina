# Search-led club discovery ("No federation – Google")

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
  website_status:'live', website_confidence:'B' (review), status:'needs_review',
  dedup_key:'search:<host>' }`. (`B`, not `A` — search-sourced is lower-trust pending review.)

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
