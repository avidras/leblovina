# Spec: Robust club extraction (no more silent 0-club scrapes)

23 federations have a detected directory; **9 extracted 0 clubs** despite the directory (and
often a club-count note) being correct. This makes extraction — not detection — the weak link.

## Verified root cause (keystone)

Ran the Czech directory (`cvf.cz/cvs/oddily/`, ~160 clubs) through the live HTML extractor:
Firecrawl returned **133,699 chars** of markdown (full table, emails inline); the LLM agent
emitted **39,033 chars** of JSON and was **cut off mid-array** at the `maxTokensToSample:16000`
output cap → `JSON.parse` threw → `Apply & upsert` crashed → **0 clubs**. Comparable static
tables that *did* work (Croatia 197, Bulgaria 139) sit right at the edge.

So the dominant failure is **output-token truncation**: the extractor asks for *all* clubs as
one JSON blob; large/rich directories overflow → invalid JSON → 0 clubs (or a crash, falsely
left `scraped`). Smaller 0-club cases (Cyprus 33, Barbados 14) and JS platforms
(Belgium, Albania/DataProject, Bahrain/volleybox) have secondary causes, surfaced by re-running
after the systemic fix.

## Decisions

1. **Chunked extraction.** Split each directory's markdown/text into ~`CHUNK` (≈25k chars)
   row-batches; run the LLM per chunk; merge + dedup. Scales to any directory size (CZE 160,
   Poland-scale). Splitting is line-aware (never mid-row where avoidable).
2. **Raise the output cap** to 32000 tokens (headroom per chunk).
2b. **Cleanliness-gated model (in n8n, not config/memory).** The `chunk` node tags each chunk
   with a `clean` flag (heuristic: high ratio of table-pipe / numbered-list lines, low ratio of
   long prose). The Anthropic node's model is a **dynamic expression**
   `clean → claude-haiku-4-5`, else `claude-sonnet-4-6`. Clean tables/lists (the common case)
   run on fast/cheap Haiku; only genuinely messy inputs escalate to Sonnet. (Sonnet on a 133k
   table ran >3 min/call; Haiku does the same clean extraction in ~9 s.)
3. **JSON parsing never crashes.** Strip fences; try `JSON.parse`; on failure salvage complete
   `{...}` club objects via regex; a chunk that yields nothing parseable is counted as a parse
   failure, not a throw. A directory that fetched fine but parsed to **0 clubs across all
   chunks → `needs_review`**, never a false `scraped`.
4. **Status truth-table (both extractors identical):** `created+updated>0 && !failed` →
   `scraped`; `failed>0` → `error`; fetched-but-0 → `needs_review`; fetch failed & 0 → `error`.
5. **Scope:** systemic fix + re-run recovers the should-work cases (static tables, volleybox/JS
   render, pagination). Genuinely hard platforms — Albania (DataProject .NET per-competition),
   Australia (8 federated sub-sites), Monaco (general non-volleyball directory) — are left
   `needs_review` with a note, tackled separately (not silently `scraped`).

## n8n changes (`extract-clubs-html`, `extract-clubs-pdf`)

- After content fetch (Firecrawl markdown / PDF text), a **`chunk`** Code node emits one item
  per (directory × chunk), carrying `{dirIndex, dirUrl, region, chunk, nChunks}`.
- The **`Extract clubs`** agent runs per chunk item (prompt = the chunk); `maxTokensToSample`
  → 32000.
- **`Apply & upsert`** groups chunk outputs by `dirIndex`, merges clubs (dedup by
  `<fed>:<uslug(name)>:<uslug(city)>`), upserts, and computes status per the truth-table. JSON
  parsing is the hardened, never-throw variant.

## Verify

- Re-run all 9 zero-club federations; assert each lands clubs (or a *justified*
  `needs_review`/`error` with a note, for the deferred platforms).
- **Regression:** re-run a sample of the 14 OK federations (Croatia, Bulgaria, Egypt, Finland);
  assert counts hold or grow (idempotent upsert), none regress to 0.

## Out of scope
- DataProject/federated/weak-directory automation (deferred, flagged).
- Pagination-crawling a directory across many pages (only the detected page(s) are scraped).
