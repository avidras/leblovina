# Spec: Human-readable status/tag labels on the FE

Every enum value the UI shows today is rendered as its raw DB token — `needs_review`,
`not_found`, `contacts_found`, `mx_only`, `club_site`, `api_endpoint`, `review_all`, etc. —
in badges, table cells, dialog fields, and filter dropdowns. Replace these with proper
human-readable labels (e.g. **New**, **Needs Review**, **Not found on Google**), while keeping
the underlying values (DB writes, filter params, option `value`s) unchanged.

This is display-only: no schema, no n8n, no value changes. Filter `<option value>` stays the
raw token; only the visible option text changes.

## Approach

Add one module `src/lib/labels.ts` holding a label map per enum plus a generic `humanize()`
fallback (`snake_case`/`kebab` → `Title Case`). Each exported helper returns the mapped label
or the humanized token, so an unmapped/new value still renders readably instead of breaking.
Pages import the helper instead of inlining the raw value or ad-hoc strings.

Centralizing also removes the scattered inline humanizations already present
(`club_site`→"club site", `multisport`→"multi", `unknown`→"unchecked"/"unclassified",
`'conf '`/`'quality '` prefixes).

## Label decisions

| enum | value → label |
|------|----------------|
| status (fed + club) | new→New, scraped→Scraped, error→Error, needs_review→Needs Review, contacts_found→Contacts Found, no_contacts→No Contacts |
| website_status | unknown→Unknown, live→Live, dead→Dead, **not_found→Not found on Google** |
| website_source | official_list→Official list, serper→Serper, manual→Manual, none→None |
| website_confidence | unknown→Unchecked, A/B/C kept as letters (grade) |
| club_type | unknown→Unclassified, volleyball→Volleyball, multisport→Multi-sport |
| verification_status | unverified→Unverified, mx_only→MX only, verified→Verified, catch_all→Catch-all, undeliverable→Undeliverable, unknown→Unknown |
| source_type | directory→Directory, club_site→Club site, manual→Manual |
| extraction_method | static→Static, js→JavaScript, api_endpoint→API endpoint, pdf→PDF, none→None |
| gate_mode | review_all→Review all, auto_safe→Auto (safe), auto_all→Auto (all) |
| confederation | unchanged (CEV/AVC/CAVB/NORCECA/CSV — acronyms) |

Other explicit copy tweaks:
- Clubs table **Website** column: empty website shows **"No website"** (was "none").
- `club_type` badge in the clubs table now shows the full word (Volleyball / Multi-sport)
  instead of the cramped "VB"/"multi" abbreviations.

`tone` selection (`statusTone`, `confidenceTone`, `clubTypeTone`) is unchanged — it keys off
the raw value, so colors stay correct.

## File-level changes

- **New `src/lib/labels.ts`** — `humanize()` + per-enum helpers: `statusLabel`,
  `websiteStatusLabel`, `websiteSourceLabel`, `confidenceLabel`, `clubTypeLabel`,
  `verificationLabel`, `sourceTypeLabel`, `extractionMethodLabel`, `gateModeLabel`.
- **`src/features/clubs/ClubsPage.tsx`** — web-status badge + filter, club-type badge + filter,
  club-status badges (table + dialog), confidence filter copy, dialog Web-status/Source fields;
  Website column empty text → "No website".
- **`src/features/contacts/ContactsPage.tsx`** — source-type badge + dialog field, verification
  badge (table + dialog) + dialog field.
- **`src/features/federations/FederationsPage.tsx`** — status badge (table + dialog) + filter,
  extraction-method dialog field + directory-URL badge.
- **`src/App.tsx`** — gate-mode `<option>` labels.

## Out of scope
- Confederation acronyms (already readable).
- Quality A/B/C and confidence A/B/C stay letters (grades, not states).
- Any DB/value/migration change.
