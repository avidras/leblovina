# Country flags

## Goal

Show a country's flag next to its name everywhere a country name is displayed, so the team can
scan the lists by region at a glance.

## Decisions

- **Unicode emoji flags**, derived from the country's ISO-3166 alpha-2 code (regional-indicator
  letters). Zero dependencies, no bundled assets. Render natively on macOS/iOS/Android/Linux.
  Known limitation: Windows browsers don't render flag emoji and fall back to the 2-letter code
  (e.g. "FR") — acceptable; the name is always shown alongside, so nothing is lost.
- **Name → ISO-2 mapping** (`src/lib/countries.ts`): FIVB/VIS country strings are standard
  English names, so we map by name. Authored as `ISO2 → [name variants]` and reversed into a
  normalized lookup at module load. Lookup key is normalized (lowercased, diacritics stripped,
  punctuation removed) so "Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast" all resolve. Aliases
  cover FIVB quirks: USA/United States, Great Britain/United Kingdom, Korea/Republic of Korea,
  Chinese Taipei/Taiwan, Czechia/Czech Republic, Türkiye/Turkey, Eswatini/Swaziland, etc.
- **`countryFlag(name): string`** returns the emoji or `''` if unknown (graceful — just no flag).
  **`<CountryLabel country>`** (`src/components/ui/country.tsx`) renders `flag + name`, with a
  `—` fallback when empty.

## Where applied

- Federations: Country column + detail-modal Country field.
- Clubs: Country column + detail-modal Country field + the active-country filter chip.
- Contacts: Country column + detail-modal Country field.

For `DialogField` (string value), country fields pass a flag-prefixed string via `withFlag()`.

## Out of scope

- SVG flag assets / a flag dependency (revisit only if Windows rendering becomes a problem).
- Flags on the `confederation`/region tags (those are multi-country regions, not a single flag).
