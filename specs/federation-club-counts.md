# Spec: Per-federation club count column

Add a **Clubs** column to the Federations list showing how many clubs have been discovered
for each federation, and make that number a link that opens the Clubs page filtered to the
federation's country.

## Goal

Give the team an at-a-glance signal of discovery yield per federation — "did the
discover→extract pipeline actually produce clubs for this country, and how many?" — plus a
one-click drill-down into those clubs.

## Decisions

- **What the count means:** every club row whose `federation` relation points at the
  federation (i.e. *all discovered clubs*, the Phase-2 extract output). Not gated on club
  `status`; Phase 3 contact-scraping is not built yet. (Confirmed with user.)
- **Counting key:** by `clubs.federation` id (exact, denormalization-independent).
- **Drill-down filter:** clicking the number opens the Clubs page filtered by the
  federation's `country` (clubs carry a denormalized `country`; this is what "for that
  country" means to the user). One federation == one country in the FIVB seed, so the
  count (by fed id) and the country filter line up in practice.
- **Data loading:** client-side, matching `useCollection`. A dedicated hook loads only the
  `federation` field of every club (`getFullList({ fields: 'federation' })`) and reduces to a
  `Record<fedId, count>`. It subscribes to `clubs` realtime (debounced) so counts update live
  as extraction writes rows — same pattern as `useCollection`.
- **Sorting:** the column is sortable (by count), consistent with the other columns.
- **Cross-page state:** the country drill-down travels in the URL as `/clubs?country=<name>`,
  consistent with the existing "view lives in the path" approach (survives refresh / is
  shareable). `ClubsPage` reads it as an initial country filter and shows a removable chip.

## File-level changes

1. `src/hooks/useClubCounts.ts` (new) — `useClubCountsByFederation(): Record<string, number>`.
2. `src/features/federations/FederationsPage.tsx` — new sortable **Clubs** column; cell is a
   button that calls `onOpenClubs(fed.country)` when count > 0; `colSpan` 8 → 9; new
   `onOpenClubs` prop threaded to `FederationRow`; `clubs` added to `SortKey` + comparator.
3. `src/features/clubs/ClubsPage.tsx` — accept `initialCountry`; add a `country` exact-match
   filter to the row filter, surfaced as a removable chip when active.
4. `src/App.tsx` — `navigate` accepts an optional `country`; encodes it as `?country=`; reads
   it back (incl. on popstate); passes `initialCountry` to `ClubsPage` (keyed so a new country
   re-inits the filter) and `onOpenClubs` to `FederationsPage`.

## Out of scope

- Status-segmented counts (e.g. contacts_found / total) — revisit in Phase 3.
- A general country dropdown on the Clubs page (the chip + free-text search cover current need).
