# Spec: Archetype fixes (Phase 3.3) — recover the 0-club federations

The Europe-wide count-QA found many CEV federations with 0 (or few) clubs. Root causes, with
evidence, and the fixes. See `specs/implementation-roadmap.md` Phase 3.3.

## Root causes (evidenced)
1. **Discovery exhausts its tool budget.** The discover agent has `maxIterations: 7`; on large/
   federated countries it returns *"Agent stopped due to max iterations"* → unparseable → no
   directory → federation stays `new`. **GER, ESP, SUI, LAT, BIH, GIB, WAL.**
2. **Federated multi-site directories.** Discovery correctly finds an *index of regional sites*
   (DEN: 5 kredse; NOR: 6 regional tabs), but the extractor scrapes the index (regions, not
   clubs) → 0. Archetype C, not yet handled.
3. **JS-SPA directories routed to embedded-JSON.** `js` → `extract_api` (embedded-JSON) fails on
   React SPAs (NED Verenigingszoeker). Should render (Firecrawl `waitFor`) or use the API.
4. **API-endpoint dirs not harvested** (NED `api.nevobo.nl/export/vereniging/{id}`).
5. **Anti-bot/cloaking** (Firecrawl blocked) — CYP, ALB, MON → Apify tier (Phase 4).
6. **`club_count` heuristic over-counts** sitemap/taxonomy/nav rows → false PARTIAL flags
   (UKR/HUN/GRE inflated; GRE actually ~OK). QA accuracy.

## This change (Steps 1 + 2)
- **Step 1 — discovery budget.** Raise `maxIterations` 7 → 18 and nudge the agent to conclude
  with best-effort JSON within budget; `Parse & Write` marks `needs_review` (not stuck `new`)
  when the output is the max-iterations sentinel. Re-run discovery for the 7 `new` feds.
- **Step 2 — js routing.** `process-federation` routes `js` → `extract_html` (Firecrawl-render
  `waitFor`) instead of `extract_api`, so JS/SPA directories render before extraction.

## Follow-ups (later steps)
- Step 3: federated multi-site extraction (Archetype C) — follow regional sub-sites (DEN, NOR,
  GER/ESP once discovered).
- Step 4: per-platform (Nevobo API, DataProject). Step 5: Apify anti-bot. Step 6: fix the
  `club_count` heuristic for trustworthy QA.

## Verify
Re-run discovery+extraction for the 7 `new` + the js feds (NED, NOR); re-run the count-QA and
confirm directories detected + clubs extracted (or justified needs_review).
