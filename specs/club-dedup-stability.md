# Spec: Stable club identity / dedup_key (non-Latin catalogs)

Fix a data-integrity bug in Phase 2 club extraction: `dedup_key` is unstable across reruns
and **collapses for non-Latin (Cyrillic/Greek/…) club names**, producing duplicate/phantom
rows and breaking the idempotent-rerun guarantee (domain rule #2). Surfaced on Bulgaria.

## Problem (grounded in prod data)

Bulgaria (`BUL`) had **165 club rows = 139 real + 26 corrupt phantoms**:

- **139 real** — `dedup_key = BUL:/subMenu/clubs/clubsList/club/<n>` (the per-club **detail
  path** was stored as `source_club_id`). Created by the original run, where the LLM
  field-mapper happened to map `source_id → url`.
- **26 phantom** — `dedup_key ∈ { BUL::, BUL:2022:, BUL:2016:, … }`. Created by a later run
  where the mapper mapped `source_id → null`, so the code fell back to
  `BUL:<slug(name)>:<slug(city)>`.

Two root causes:

1. **`slug()` strips all non-`[a-z0-9]`.** `slug('Академик волей') = ''`,
   `slug('Левски') = ''`, `slug('АРДА 2022') = '2022'`. All-Cyrillic names collapse to an
   empty slug, so ~139 clubs map onto just 26 distinct keys (`BUL::` catches every
   digit-less name) — overwriting each other and destroying data.
2. **The LLM field-mapper is non-deterministic.** It mapped the source's `url` field to
   `source_id` on one run and to `detail_url`/`null` on another. So `dedup_key` is not stable
   across runs → reruns create a parallel set of rows instead of updating, violating the
   "treat reruns as idempotent" rule.

These also blocked the `detail_url` backfill: the extractor now computes collapsed keys, so
its writes target phantom rows, never the 139 real ones.

## Decisions (interactive Q&A)

1. **Club identity = deterministic ID derived from the detail URL/path, not the LLM.**
   When the source gives a per-club detail path/url (e.g. `…/club/138`), use **its URL path**
   as `source_club_id` (deterministic, script-agnostic, and equal to what the original 139
   real rows already store → reruns update them in place). Do **not** depend on which key the
   LLM mapper assigned. A **Unicode-safe slug** is used only as a last-resort fallback when no
   detail path/id exists at all.
2. **Unicode-safe slug.** Replace the ASCII-only `slug()` with `uslug()` using
   `\p{L}\p{N}` (the `u` flag) so Cyrillic/Greek/etc. letters survive
   (`uslug('Академик волей') = 'академик-волей'`). Used for the no-id fallback and never
   collapses distinct names to the same key.
3. **Clean up corrupt data, then re-extract.** Delete the 26 phantom Bulgaria rows, then
   re-run extraction with the fixed dedup so the 139 real rows get `detail_url` backfilled and
   no new duplicates are created.

## Identity algorithm (both extractors)

Per club row, deterministically (no LLM dependence for identity):

```
detailRaw  = first non-empty of [ mapped detail_url value, a url/path-looking source_id value ]
detail_url = absolutize(detailRaw) against the directory URL        // absolute, for the url field
stableId   = urlPath(detailRaw)    // e.g. "/subMenu/clubs/clubsList/club/138" — matches existing rows
source_club_id = stableId
dedup_key  = stableId ? `${FIVB}:${stableId}`
                      : `${FIVB}:${uslug(name)}:${uslug(city)}`     // Unicode-safe fallback
```

- `urlPath()` returns the pathname for an absolute URL, or the trimmed value as-is when it is
  already a root-relative path — so `/subMenu/.../138` and
  `https://www.bvf.bg/subMenu/.../138` yield the **same** `stableId`, matching the stored 139.
- `absolutize()` is the existing `absol()` helper (resolves against the directory `sourceUrl`).
- A `source_id` value that looks like a URL/path is treated as a detail path (not a clean id),
  so the mapper mapping `url`→`source_id` vs `url`→`detail_url` now converges to the same key.

No schema changes — `clubs` already has `detail_url (url)`, `source_club_id (text)`,
`dedup_key (text, unique)`.

## File-level changes

1. **`n8n/extract-clubs.json`** (api/embedded-JSON extractor — `Apply & upsert` node):
   add `uslug()`; compute `detailRaw`/`detail`/`stableId` as above; set
   `source_club_id = stableId`, `detail_url = detail`, and the Unicode-safe fallback in
   `dedup`. (Already added: `detail_url` to the write payload.)
2. **`n8n/extract-clubs-html.json`** (Firecrawl extractor — `Apply & upsert` node):
   same `uslug()` + detail-path-derived `stableId`/`source_club_id`/`dedup`. (Already added:
   `detail_url` to the Firecrawl schema + write payload.)
3. **Deploy:** push both updated workflows into the live n8n instance by name-match
   (`PUT /api/v1/workflows/{id}` preserving credentials/webhook), then deactivate→reactivate
   so the webhook serves the new code. Verify the executing code actually changed.
4. **Data cleanup:** delete the 26 phantom `BUL` rows (collapsed keys / non-path
   `source_club_id`).
5. **Re-extract Bulgaria** and verify: 139 real rows now carry `detail_url`, total rows back
   to 139 (no phantoms), no new duplicates.
6. **Docs:** note the Unicode-safe dedup rule in `CLAUDE.md` / `specs/club-discovery.md`.

## Out of scope

- Resolving each club's **own external website** (`website_url`) — Stage 3 "Resolve" (Serper).
- Backfilling other federations (apply the same re-extract once validated on Bulgaria).
- Changing the LLM mapper itself — identity no longer depends on it; the mapper still supplies
  name/city/website hints.
