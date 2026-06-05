# Club extraction (html) — reliable markdown + LLM, no silent failures

Fixes the `extract-clubs-html` n8n workflow, which returned **0 clubs for whole
federations while reporting `status: scraped`**. Discovered on the Croatian
Volleyball Association (CRO): two valid `static` directories were saved, the row
was marked `scraped`, yet zero clubs landed.

## Root cause

Two independent bugs in `n8n/extract-clubs-html.json`:

1. **Firecrawl's json/LLM extraction is unreliable on these pages.** The node
   scraped with `formats:['json']` + `jsonOptions` (Firecrawl runs an LLM to emit
   structured data). On the CRO directory this **intermittently** returns
   `{success:false, code:'SCRAPE_TIMEOUT'}` — observed failing twice then
   succeeding on an identical third call. Meanwhile a plain `formats:['markdown']`
   scrape of the same URL succeeds instantly (~0.2 s fetch, 44 KB markdown) and
   yields a clean pipe-table: `Naziv kluba | Adresa | Grad | Web stranica`, ~180
   rows, with each club's own website as a link.

2. **The failure was silently swallowed.** Apply read
   `clubs = (((fcx.data||{}).json||{}).clubs) || []`. On a Firecrawl failure there
   is no `data`, so `clubs` became `[]`, the upsert loop ran zero times, `failed`
   stayed `0`, and the federation was patched to `scraped` — indistinguishable
   from "directory genuinely had no clubs". The Firecrawl node's
   `onError: continueRegularOutput` means its error body flows on to Apply, so the
   whole execution "succeeds".

## Decisions

1. **Scrape markdown, extract with our own Claude agent.** Replace Firecrawl's
   flaky json mode with a reliable `formats:['markdown']` scrape, then a
   `langchain.agent` (Claude `claude-sonnet-4-6`, the `Anthropic (leblovina)`
   credential) maps the markdown to `{clubs:[{name,city,region,website,detail_url}]}`.
   This mirrors the `extract-clubs (api_endpoint)` workflow's existing "Map fields"
   Claude step and is general across directory layouts (tables, lists, cards).
   Chosen over deterministic table-parsing (brittle: only clean tables) and over
   keeping json-mode-with-retry (still slow, still spends Firecrawl LLM credits).
2. **Never report `scraped` on a scrape/parse failure.** Apply now distinguishes:
   - Firecrawl returned no markdown → `status: error`, note carries the Firecrawl
     `error`/`code` + URL.
   - LLM returned 0 clubs from a non-empty page → `status: needs_review`
     (surfaced for a human, not a false success).
   - Clubs upserted with ≥1 failure → `status: error` (unchanged).
   - All clubs upserted cleanly → `status: scraped` (unchanged).
3. **Drop self-referential websites.** Directory tables often render a
   "view page" link back to the directory itself as the club's website column.
   The agent is told to ignore links pointing back to the listing, and Apply also
   strips any `website` whose host equals the directory host as a backstop.
4. **Raise the model's max output.** ~180 clubs ≈ 5–6 K output tokens, above the
   node default. Set `maxTokensToSample: 16000`. NB: a single directory far larger
   than this could still truncate the JSON — Apply's `JSON.parse` failure path then
   marks `needs_review` rather than fabricating a partial list.

The dedup_key derivation (detail-URL path, else Unicode-safe `uslug`) from
[`club-dedup-stability.md`](./club-dedup-stability.md) is unchanged — only the
*source* of the `clubs` array changes (Claude agent output, not Firecrawl json).

## Node-level changes (`n8n/extract-clubs-html.json` + live workflow)

- **`Firecrawl Extract` → `Firecrawl Scrape`** — body becomes
  `{ url, formats:['markdown'], onlyMainContent:false, timeout:100000 }`; keeps
  `onError: continueRegularOutput` so failures reach Apply (which now handles them).
- **+ `Anthropic Chat Model`** (`lmChatAnthropic`, `claude-sonnet-4-6`,
  `maxTokensToSample:16000`) wired `ai_languageModel` → the agent.
- **+ `Extract clubs`** (`langchain.agent`) — system message defines the
  `{clubs:[…]}` contract and the website/detail_url rules; prompt feeds the scraped
  markdown + source URL.
- **`Apply & upsert`** — reads clubs from the agent output (fence/prose-tolerant
  `JSON.parse`), adds the Firecrawl-failure and empty-result branches above, and
  the self-referential-website strip. Upsert/dedup loop otherwise unchanged.
- **Connections:** `pick url → Firecrawl Scrape → Extract clubs → Apply & upsert →
  Respond`; `Anthropic Chat Model → Extract clubs (ai_languageModel)`.

## Amendment — extract all directories, merge by name, robust detail detection

Follow-up after Croatia/Romania review (supersedes the "first directory only" and
detail-path-key behaviour above):

1. **Extract every registered directory, not just the first.** `pick url` now emits one item
   per qualifying `directory_urls` entry (`static`/`js`/`pdf` — Firecrawl renders PDFs to
   markdown too; see [`club-extract-static-pdf.md`](./club-extract-static-pdf.md) for the
   `process-federation` routing that sends those methods here); Firecrawl Scrape + Extract
   clubs run per item; `Apply` runs **once for all items** (`$('…').all()`, index-aligned)
   and upserts every directory's clubs in one pass, then patches the federation status once.
2. **Name-based merge key.** `dedup_key = <fed>:<uslug(name)>:<uslug(city)>` (not detail-path)
   so the same club across a federation's overlapping lists becomes one row. `detail_url`
   and `website` are **backfilled** on update and never blanked. See the amendment in
   [`club-dedup-stability.md`](./club-dedup-stability.md).
3. **Robust `detail_url` detection.** Strengthened agent prompt (copy the club's own link
   href, strip `**`/category codes) **plus** a deterministic backstop in `Apply`: a
   normalized *anchor-text → same-site href* map built from the Markdown fills any
   `detail_url` the LLM missed. Same-site check drops social/self-referential links.
4. **Failure handling unchanged in spirit**, now aggregated across directories: all scrapes
   failed → `error`; any upsert failure → `error`; scrapes ok but zero clubs → `needs_review`;
   else `scraped`.

## Out of scope

- The `extract-clubs (api_endpoint)` workflow keeps its detail-path identity (stable-id
  catalogs; switching it would orphan Bulgaria's existing keys).
- **Discovery picking the right page.** Romania's registered directory (`/cluburi/`) carries
  no per-club links — the detail pages live on `/cluburi_volei/`. The extractor can only
  detect links that are on the crawled page; getting discovery to register the detail-bearing
  page is a separate fix (here the directory URL is corrected by hand to demonstrate).
- City-normalization drift across lists can still split a club into two rows; mitigated by the
  prompt (town only, no postal code), not eliminated.
