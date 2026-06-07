---
name: leblovina-extract-clubs
description: Run club discovery/extraction for one federation or a batch — pick the right extractor (process-federation, or html/pdf/api/federated/namelist/platform-specific), trigger it, and verify the club count landed. Use for "extract clubs for <country/federation>", "re-extract <fed> from its directory", "process all CEV federations", "discover the club directory for <fed>". For federations that stubbornly return zero, use leblovina-fix-zero-clubs instead.
---

# Extract clubs

Trigger and verify club extraction. Read `leblovina-ops` first (creds, endpoints, primitives).
Context: `specs/club-discovery.md`, `specs/club-extract-robustness.md`.

## Pick the path
- **Don't know the directory yet, or want the full pipeline:** `POST /webhook/process-federation
  {id}` — discovers the directory, applies the extraction gate (`settings.extraction_gate`:
  `review_all|auto_safe|auto_all`), and routes to the right extractor. Batch:
  `POST /webhook/batch-process {ids}` (async fan-out).
- **Directory already known, re-extract only:** call the matching extractor directly with `{id}`
  (optionally `{url}` to force one directory):
  - generic: `extract-clubs-html` (static or Firecrawl-render), `extract-clubs-pdf`,
    `extract-clubs` (api_endpoint), `extract-clubs-federated` (>2 regional dirs),
    `extract-clubs-namelist` (plain name list).
  - platform: `-dataproject`, `-eliterro`, `-ffvb`, `-nevobo`, `-nif`, `-nor`, `-svbf-map`, `-sui`.
- **Detail-page contacts** (directories that expose contacts on per-club pages):
  `extract-clubs` then `extract-club-contacts {id}`.

## Resolve the target federation id
```js
const f=(await (await fetch(PB+`/api/collections/federations/records?perPage=1&filter=${encodeURIComponent("country='Romania'")}&fields=id,country,fivb_code`,{headers:H})).json()).items[0];
```
(Or `fivb_code='ROU'`.) For a confederation batch, list `confederation='CEV'` ids.

## Trigger + verify
```js
await fetch(env.N8N_BASE_URL.replace(/\/+$/,'')+'/webhook/process-federation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:f.id})});
// extractors respond immediately and run in background — poll the count:
const n=await count('clubs',`federation='${f.id}'`);
```
- Compare the resulting count to the expected roster (discovery note / count on the source page).
  The `federations.club_count` field is **stale** — re-count actual `clubs` records.
- Re-runs are idempotent (`clubs.dedup_key` unique). Over-extraction (e.g. a fed scraping both a
  clubs page and an address book) shows as a count far above the estimate — restrict the wrong
  `directory_urls` entry and re-run.
- Discovery occasionally blanks good `directory_urls` on an empty result — don't let a failed
  re-discovery wipe a fed that already has clubs.

When a federation returns 0 and the directory is a JS app / open API / known platform, switch to
**leblovina-fix-zero-clubs** (per-platform enumeration).
