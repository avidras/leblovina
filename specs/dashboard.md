# Dashboard view

A landing view with two parts: (1) headline **stat boxes** (live totals, each links to its
list), and (2) a client-facing, non-technical **"How it works"** explainer of the pipeline.

## Stat boxes (proposed, data-grounded)

Each box shows a big number + a short sub-line and navigates to the relevant list on click.
Counts are live (PocketBase `getList` totals, fetched in parallel on mount).

1. **Federations** — total (e.g. 218); sub: "N scraped". → Federations.
2. **Clubs** — total (≈9.8k). → Clubs.
3. **Contacts** — total (≈7.6k) — the headline deliverable; sub: "X from club sites · Y from
   directories". → Contacts.
4. **Countries covered** — distinct countries that have clubs. → Clubs.
5. **Clubs with a website** — count with a resolved site (≈6.3k); sub: "of N". → Clubs.
6. **Clubs scraped for contacts** — count with a site-scrape note (≈3.5k). → Clubs.

Plus a thin **scrape-queue progress** line when the queue is active (done / queued), reusing
the existing queue counts.

(Boxes link to the view; per-filter deep-linking is out of scope — filters now persist anyway.)

## Breakdown (clubs + contacts), tabbed

Below the boxes, a **Breakdown** section with a tab switch:
- **By confederation** (default) — one row per `CONFEDERATION` (clubs→federation→confederation),
  plus appended provenance rows for routes whose confederation is blank: **"No federation
  (Google search and scrape)"** (`website_source='search'`) and **"Tournaments"**
  (`tournament!=''`). Counts via parallel `getList` totals (cheap; 5 confederations).
- **By country** — one row per country with its flag (`CountryLabel`), clubs + contacts,
  sorted by clubs desc, scrollable. Country totals are route-agnostic (every club has a
  `country`, so search/tournament clubs roll into their country). **Lazy**: only computed when
  the tab is first opened. Implemented as `useCountryBreakdown` — two batched `getFullList`
  scans (clubs `country`; contacts `expand.club.country`, the same pattern as `useCountries`,
  ≈27k rows) tallied client-side into a `Map`. No new aggregation endpoint/field.

## How it works (client-facing copy)

A numbered, plain-language walkthrough (icon + title + 1–2 sentences each), no jargon:

1. **Start from the world's federations** — we load every national volleyball federation from
   the sport's official global directory.
2. **Find each federation's club list** — for every federation we locate its official club
   directory online.
3. **Extract the clubs** — we read those directories (web pages, PDFs, or the platforms they
   run on) and pull out every club with its town/region and any listed email or website.
4. **Find the missing websites** — for clubs with no listed site, we search the web and verify
   which result is genuinely that club's own site.
5. **Gather the contacts** — we visit each club's own website and collect contact emails (and
   names/roles where shown), filtering out website-builder/agency noise.
6. **Make names readable** — clubs written in other alphabets (Cyrillic, Greek, …) get an
   English/Latin version.
7. **Organise & export** — everything is searchable, filterable and exportable to CSV.

A short "Behind the scenes" footnote names the tooling in accessible terms: automated web
search, a page-rendering engine for modern sites, and AI models that read and classify pages —
all run automatically on a schedule.

## Wiring

- New `dashboard` view (added to `App.tsx` VIEWS, made the default/home; nav lists it first).
- `src/features/dashboard/DashboardPage.tsx` — stat cards (live counts) + how-it-works section.
- Reuses `useCountries` for the country count and the existing nav for box click-through.

## Out of scope
- Charts/time-series (no historical snapshots stored).
- Per-filter deep links from boxes.
