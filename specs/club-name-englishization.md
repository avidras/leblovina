# Club name englishization (non-Latin → English/Latin)

## Goal

Many clubs are stored under their native, non-Latin name (Cyrillic already in the DB for
Ukraine; Asian/Middle-Eastern feds will add Japanese, Korean, Chinese, Thai, Arabic, Hebrew,
Greek, etc.). The team needs a readable English/Latin name for each, and the export's `Club`
column should be human-readable. This adds an **English name** to such clubs without ever
losing the original native name.

## Decisions (from the design Q&A)

1. **Derivation = LLM romanize + light translate.** Transliterate the proper-noun part to
   Latin script; translate only generic descriptors (e.g. "Волейбольний клуб Поділля" →
   "Volleyball Club Podillia"; "ВК Решетилівка" → "VC Reshetylivka"). No web lookup. Never
   invent — when unsure, transliterate (domain rule #1 spirit: faithful, not fabricated).
2. **Scope = non-Latin scripts only.** A name qualifies iff it contains a letter in a
   non-Latin script (Cyrillic, Greek, Armenian, Hebrew, Arabic, Devanagari, Thai, Hangul,
   Kana, CJK, …). Latin-script names (French, German, Spanish, Turkish, Vietnamese) are left
   as-is — they're already exportable. Deterministic gate (regex), so no LLM spend on names
   that don't need it.
3. **Runtime = batch enrichment workflow.** A dedicated n8n workflow (mirrors Resolve):
   find clubs that need it, batch them to the LLM, write back. Triggered on-demand from the
   UI/API. Backfills the existing ~275 Cyrillic clubs and is re-run after each new fed.
   Idempotent (skips clubs that already have an English name).
4. **Display/export = English preferred, original kept.** New `clubs.name_en` field; the
   native `name` is never modified. UI clubs list shows `name_en` as primary with the native
   `name` as secondary. Export's single `Club` column uses `name_en` when present, else
   `name`. Keeps the agreed export shape (domain rule #6) intact.

## Schema change

`clubs.name_en` — `text`, optional, default empty. Added via an **idempotent** migration
(`pocketbase/pb_migrations/`): guard with `collection.fields.getByName('name_en')` and return
early if present (per CLAUDE.md — migrations must be idempotent because schema may already
exist from a live-API add). No new index (we never filter/dedup on it).

No provenance field: the workflow only processes clubs where `name_en` is empty **and** the
native name is non-Latin, so a populated `name_en` (LLM- or manually-set) is simply skipped.
To re-generate, clear `name_en`.

## Detection (deterministic non-Latin gate)

A name needs englishization iff it matches a non-Latin-letter regex. Use explicit Unicode
ranges (robust across engines) covering the scripts we expect:

```
const NONLATIN = /[Ͱ-ϿЀ-ԯ԰-֏֐-׿؀-ۿ܀-ݏऀ-ॿ฀-๿ᄀ-ᇿ぀-ヿ㄰-㆏ㇰ-ㇿ㐀-䶿一-鿿ꥠ-꥿가-힯豈-﫿]/
```
(Greek, Cyrillic+supplement, Armenian, Hebrew, Arabic, Syriac, Devanagari, Thai, Hangul Jamo,
Kana, CJK Ext-A + Unified, Hangul Syllables, CJK compat.) Applied in n8n (gating which clubs
go to the LLM) — and reused client-side only if we ever need to flag rows.

## n8n workflow: `englishize-clubs`

Async (`responseMode: onReceived`), mirrors the Nevobo/NIF batch shape.

- **Webhook** body: `{ ids?: string[] }` — optional explicit club ids; omitted ⇒ process all
  clubs that need it.
- **Config** (pbUrl) → **PB Auth** (superuser).
- **Collect** (Code): page through `clubs` with `name_en=""` (and, if `ids` given, restricted
  to those), filter in-code by the NONLATIN regex, and chunk into batches of ~50 names.
  Emits one item per batch carrying `[{id, name}]`.
- **Loop** (`splitInBatches`, size 1) → **Englishize batch**:
  - langchain **agent** + **`lmChatGoogleGemini`** sub-node (cred `bk0TwlDz0lEZUfic`,
    `gemini-2.5-flash` — high-volume LLM per project convention; model choice lives in the
    node, not in memory). Prompt: for each `{i, name}`, return a concise English/Latin
    rendering — transliterate proper nouns to standard romanization, translate only generic
    descriptors, keep sensible abbreviations (ВК→VC), **never invent; transliterate when
    unsure**. Output strict JSON array `[{i, name_en}]`.
  - **never-crash JSON parse** (same salvage approach as the extractors), then PATCH each
    club's `name_en` (skip blanks). `onError: continueRegularOutput`, `retryOnFail`.
- **Finalize**: report counts.

Idempotent: a re-run only sees clubs still missing `name_en`. Safe to run repeatedly and
after every new non-Latin fed.

Per CLAUDE.md, the workflow JSON is committed under `n8n/englishize-clubs.json` **and** PUT to
the live n8n instance in the same change; the two must not drift. Webhook env var:
`VITE_N8N_ENGLISHIZE_CLUBS_URL` (UI trigger), added to `.env.example`.

## UI changes

- `src/lib/pb.ts`: add `name_en: string` to the `Club` interface.
- `src/lib/n8n.ts`: `triggerEnglishizeClubs(ids?)` posting to `VITE_N8N_ENGLISHIZE_CLUBS_URL`.
- `src/features/clubs/ClubsPage.tsx`: club-name cell is a **two-line cell mirroring the
  Country column** — `name_en` on the top line (primary, `font-medium`), the native `name` on
  a smaller muted line below (`text-xs text-neutral-500`). When `name_en` is empty, show
  `name` only (one line). Detail-dialog heading likewise shows `name_en` with the native name
  as a smaller inline secondary. Add an "Englishize names" action (batch trigger), consistent
  with the Resolve buttons.
- Export (wherever the CSV/Excel `Club` column is produced): `Club = name_en || name`.

## Out of scope

- Latin-script translation / "over-translating" already-readable names (scope decision #2).
- Inline englishization inside extractors (runtime decision #3 — batch only for now; an
  extractor hook can be added later if desired).
- Official-English-name web lookup (approach decision #1).
- Romanizing `city`/`region` (names only for now; revisit if export readability needs it).

## Validation

Run the workflow over the existing **UKR (275 Cyrillic clubs)** backlog; spot-check a sample
(e.g. "Поділля" → "Podillia", "ВК Решетилівка" → "VC Reshetylivka", "МХП-Ладижин-ШВСМ-Колос"
→ a sensible romanization). Confirm idempotency (second run processes 0).
