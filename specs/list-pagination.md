# Spec: Server-side pagination for the list pages

Move the three data-table pages (clubs, contacts, federations) off the "load the whole
collection into memory and filter/sort/search client-side" model and onto **server-side
paginated queries**. Clubs is ~6.5k rows and slow to load; contacts ~3.2k and growing.
Default page size **100**.

Today every list uses `useCollection`, which calls `getFullList` (capped batches) and then
the page does all filtering, sorting, and search over the in-memory array with `useMemo`.
That doesn't scale and is the source of the slow initial load.

## Decisions (from interactive Q&A)

1. **Scope: all three lists** (clubs, contacts, federations) get pagination. Clubs and
   contacts move to true server-side loading; federations too (see #3).
2. **Batch actions act on the whole filtered set, not just the visible page.** On the clubs
   page the "Resolve unresolved", "Re-resolve all", and "Re-check confidence" buttons keep
   operating over every club matching the current filter. Their counts come from server-side
   **count** queries (`getList(1, 1).totalItems`); clicking fetches all matching ids across
   pages (`getFullList({ fields: 'id' })`) and passes them to the existing n8n trigger.
3. **Federations goes fully server-side too**, accepting two trade-offs the user approved:
   - the custom status **rank** order (`scraped → needs_review → error → new`) is replaced by
     plain alphabetical status sort (PocketBase can only `ORDER BY` real columns);
   - the **club-count column is no longer sortable** (the count is an aggregate, not a
     column). The count is still displayed.
4. **Default page size 100**, with a per-page selector (50 / 100 / 200).

No schema or migration changes. No n8n changes.

## How it works

PocketBase's REST list endpoint already paginates: `getList(page, perPage, { filter, sort,
expand })` returns `{ items, page, perPage, totalItems, totalPages }`. We push all
filter/sort/search into the `filter`/`sort` query params and render only the returned page.

- **Filter** is built from the page's filter controls into a PocketBase filter expression,
  using `pb.filter(expr, params)` for safe value binding (prevents injection / quote bugs).
- **Search** becomes an OR of `~` (contains) clauses across the searchable fields.
- **Sort** is the SDK sort string (`+field` / `-field`).
- **Relation fields** (contacts) use dot-notation: `club.name`, `club.country` work in both
  `filter` and `sort` for a single (maxSelect 1) relation — supported by PocketBase. The
  contacts page already loads `expand: 'club'`, so the related record is present for display.

### Realtime + races
The paged hook keeps the existing realtime behaviour: subscribe to the collection and, on any
event, **debounced-refetch the current page** (not the whole list). Because
`pb.autoCancellation(false)` is set globally, overlapping requests are not auto-cancelled, so
the hook guards against out-of-order responses with a monotonic request-id ref (a stale
response is dropped). Search input is debounced (~300ms) before it enters the filter string so
typing doesn't fire a request per keystroke.

### Page reset
Changing any filter, the sort, or the page size resets the current page to 1 (done in the
control handlers so the filter change and the page reset land in the same render — one
refetch, not two).

## File-level changes

### New — `src/hooks/usePagedCollection.ts`
Generic paged loader. Signature:
```ts
usePagedCollection<T>(collection, { page, perPage, sort, filter?, expand? })
  : { items, page, perPage, totalItems, totalPages, loading, error, reload }
```
- Calls `getList(page, perPage, { sort, filter: filter || undefined, expand })`.
- Realtime subscribe + debounced refetch of the current page.
- Request-id ref to drop stale responses.

### New — `src/hooks/useDebouncedValue.ts`
`useDebouncedValue(value, ms)` — small helper to debounce the search box into the filter.

### New — `src/components/ui/pagination.tsx`
Presentational `Pagination` row shown under each table:
- "Showing X–Y of Z" (computed from page/perPage/totalItems),
- Prev / Next buttons (disabled at the ends),
- "Page p / n",
- per-page `Select` (50 / 100 / 200).
Props: `{ page, perPage, totalItems, totalPages, onPage, onPerPage }`.

### Changed — `src/features/clubs/ClubsPage.tsx`
- Replace `useCollection` with `usePagedCollection` (`page`, `perPage=100` state; sort string
  built from the existing sort state — `name` / `country` / `city` / `status`; the removed
  `region` sort is already gone from the UI).
- Build the filter from country / hasSite / ws / wc / ct / debounced-q. The `unknown`
  selections for web-status / confidence / type match both the literal `unknown` and empty
  string (e.g. `(website_status = 'unknown' || website_status = '')`), preserving today's
  `(x || 'unknown')` semantics.
- Drop the client-side `rows` `useMemo`; map the table over the server-returned `items`.
- Header counter shows `totalItems` (the filtered total) instead of `rows.length / items.length`.
- **Batch-action counts** (`unresolvedCount`, `recheckCount`, all = `totalItems`): an effect
  runs `getList(1, 1).totalItems` for the unresolved and recheck subset filters whenever the
  base filter changes. `resolveWebsites(mode)` confirms using these counts, then fetches the
  matching ids with `getFullList({ filter, fields: 'id' })` and calls `triggerBatchEnrich` as
  before.
- Empty-state keys off `totalItems === 0 && !loading`.
- `contactCounts` is scoped to the **visible page's** club ids (see hook change below).
- `<Pagination/>` rendered under the table.

### Changed — `src/features/contacts/ContactsPage.tsx`
- `usePagedCollection<Contact>('contacts', { …, expand: 'club' })`.
- Filter from club / vs / src / debounced-q; `q` searches `email`, `club.name`, `position`,
  `phone`, `club.country`. `vs`/`src` `unknown`-style defaults mirror today's
  `(x || 'unverified')` / `(x || 'directory')` semantics.
- Sort maps `club → club.name`, `country → club.country`, plus `email` / `position`.
- `<Pagination/>` under the table.

### Changed — `src/features/federations/FederationsPage.tsx`
- `usePagedCollection<Federation>('federations', …)`.
- Sort string from conf / name / country / status (alphabetical) — **`status` is now a plain
  field sort; the `clubs` count column loses its sort affordance** (per decision #3).
- Filter from conf / status / debounced-q (`q` over `name`, `country`, `fivb_code`).
- Club counts scoped to the visible page's federation ids.
- `<Pagination/>` under the table.

### Changed — `src/hooks/useContactCounts.ts` and `src/hooks/useClubCounts.ts`
Both currently `getFullList` the entire child collection to aggregate counts — the same
"load everything" cost we're removing. Change each to accept the **visible parent ids** and
query only those (`filter` = OR of `parent = id`, `fields` = parent field), reducing to a
count map. Empty ids → `{}`. Keep the debounced realtime refetch.

## Out of scope
- No denormalized count columns (would let federations sort by club count server-side) — not
  worth a schema migration for a ~218-row page.
- No cursor/infinite-scroll; classic prev/next + page size is enough here.
- No changes to n8n, the enrich/resolve workflows, or export.
