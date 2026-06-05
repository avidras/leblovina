# Spec: Dedicated PDF club-extraction path

Some federations publish their member-club list as a **PDF** (Finland, Estonia, …). Routing
`pdf` through the Firecrawl+LLM HTML extractor works *sometimes* (Finland) but is unreliable:
Estonia's PDF — a clean 2-page text-layer table of ~N clubs with addresses, contacts, phones,
emails and websites — makes Firecrawl return `SCRAPE_ALL_ENGINES_FAILED` (both its `documents`
and `pdf` engines), even though `pypdf` extracts the text instantly. Firecrawl is the wrong
tool for PDFs.

## Decision

Add a **dedicated PDF extractor workflow** (`n8n/extract-clubs-pdf.json`) that does NOT use
Firecrawl: n8n fetches the PDF as binary and parses its text with the built-in
**Extract from File** node, then runs the *same* Claude agent + upsert as the HTML extractor.
Firecrawl stays for `static`/`js` HTML only.

- **Per-federation routing (`process-federation` → "Decide & Extract", auto gate):**
  if any directory entry is `pdf` → `extract_pdf` (the PDF list is the authoritative, complete
  source; the sibling static "landing" page is just a link to it). Else `api_endpoint`/`js` →
  `extract_api` (0-result → html fallback); `static` → `extract_html`; else `review`.
  This fixes federations whose summary `extraction_method` is mislabelled `static` but whose
  real club list is the linked PDF (e.g. Estonia).
- **`extract-clubs-html`** reverts to `static`/`js` only in its `pick url` filter (PDFs no
  longer go through Firecrawl).
- **Status** uses the same honest logic: clubs created → `scraped`; fetch/parse failed and 0
  clubs → `error`; parsed-ok-but-0-clubs → `needs_review`.

## New workflow shape (`extract-clubs-pdf`)

`Webhook(extract-clubs-pdf)` → `Config` → `PB Auth` → `Get Federation` → `pick pdfs`
(directory entries with `extraction_method='pdf'`, one item each) → `Fetch PDF` (HTTP GET,
binary → `data`, onError continue) → `Extract PDF text` (Extract-from-File, operation `pdf`)
→ `Extract clubs` (Claude agent, prompt = the extracted text) → `Apply & upsert`
(index-aligned over the pdf items; name-based dedup `<fed>:<uslug(name)>:<uslug(city)>`;
captures the club's own website from the PDF; `detail_url` stays empty — PDFs have no per-club
links) → `Respond`. Reuses the PocketBase-admin, Firecrawl-less, Anthropic creds already in n8n.

## File-level changes

1. `n8n/extract-clubs-pdf.json` (new) — the workflow above; create + activate in live n8n.
2. `n8n/process-federation.json` — add `extractPdfUrl` to Config; route pdf-bearing
   federations to `extract_pdf`.
3. `n8n/extract-clubs-html.json` — `pick url` filter back to `['static','js']`.
4. Verify against prod: Estonia 1 → full club list, status `scraped`.

## Out of scope

- Image-only / scanned PDFs with no text layer (would need OCR) — those stay `needs_review`.
- Harvesting the PDF's emails/phones into `contacts` — that's Phase 3; this path only fills
  the `clubs` row (name/city/region/website).
