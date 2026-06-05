# Spec: Fix static / PDF club extraction + honest empty status

Some federations were marked `scraped` with **zero clubs** even though their directory clearly
lists clubs. Verified against prod for **Finland** (FIN) and **San Marino** (SMR): both have 0
club rows yet status `scraped`.

## Root causes (verified)

1. **Empty extraction reported as success.** The embedded-JSON extractor
   (`n8n/extract-clubs.json` → "Apply & upsert") ends with
   `const fstatus = failed===0 ? 'scraped' : 'error'`. With 0 clubs the loop never runs, so
   `failed===0` is vacuously true → federation marked `scraped` despite extracting nothing.
   (The HTML extractor already handles this correctly — `needs_review` on zero clubs.)
2. **`static` plain-HTML lists have no working extractor.** `process-federation` routes
   `static` → `extract_api` (embedded-JSON), which only parses JSON / `__NEXT_DATA__` /
   `application/json` blobs. SMR's `fspav.sm/societa-affiliate` is an Elementor WordPress page —
   club names are plain HTML headings, no JSON array → `best=[]` → 0 clubs. The Firecrawl+LLM
   HTML extractor (`extract-clubs-html`) is built for exactly this but was never routed to.
3. **PDF sources have no extractor.** FIN's complete ~168-club list is a PDF
   (`Jasenet-nettisivulle-1.pdf`); `pdf` was routed to `review`. The HTML extractor's
   `pick url` only accepted `static`/`js`, so PDFs were never scraped — even though **Firecrawl
   parses PDFs into markdown natively**, so the existing Firecrawl+LLM path can handle them.

## Decisions

- **One extractor for unstructured sources.** Static HTML *and* PDFs both go through the
  Firecrawl+LLM HTML extractor (`extract-clubs-html`); Firecrawl turns each into markdown and
  the existing LLM agent maps clubs. No separate PDF tool/library.
- **Routing (`process-federation` → "Decide & Extract"), when the gate allows auto:**
  - `api_endpoint` → `extract_api` (JSON API)
  - `js` → `extract_api` (embedded-JSON), **fall back to `extract_html` if it yields 0 clubs**
    (js pages that don't actually embed a parseable array)
  - `static` → `extract_html` (Firecrawl+LLM) directly
  - `pdf` → `extract_html` (Firecrawl parses the PDF)
  - everything else / `review_all` → `review` (needs_review)
- **Honest status everywhere:** an extractor that fetched/mapped fine but produced 0 clubs sets
  `needs_review`, never `scraped`. Mirrors the HTML extractor's existing logic in the
  embedded-JSON extractor.

## File-level changes

1. `n8n/extract-clubs.json` ("Apply & upsert") — replace the `scraped`/`error` ternary with
   tri-state: `created+updated>0 && !failed → scraped`; `failed>0 → error`; else
   `needs_review`.
2. `n8n/extract-clubs-html.json` ("pick url") — accept `pdf` alongside `static`/`js` in the
   directory-entry filter, so Firecrawl scrapes the linked PDF.
3. `n8n/process-federation.json` ("Decide & Extract") — new routing table (above); add the
   `js` → 0-result → `extract_html` fallback; record the effective route in the return payload.
4. Deploy all three updated workflows to the live n8n via the API; re-run extraction for FIN +
   SMR and verify club rows land and status flips to `scraped`.

## Out of scope

- Login-gated registries (Turkey/Japan) and JS BI dashboards (Suomisport) — still `review`.
- Per-row "Extract clubs" button URL (`VITE_N8N_EXTRACT_CLUBS_URL`) is unset in prod; the batch
  `process-federation` path is what runs and what this fixes.
