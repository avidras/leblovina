# Spec: Capture club contacts during directory extraction (Phase 3, brought forward)

Some federation directories already expose **club contact details** — in the list itself
(Portugal, Estonia, Czechia PDFs/HTML carry name/phone/email columns) or on the club's detail
page (Bulgaria). We already fetch that content during club extraction, so we should persist the
contacts now instead of re-scraping every club in Phase 3.

## Decision: a real `contacts` collection now

Bring the Phase-3 `contacts` entity forward (matches the design in `CLAUDE.md`). One club →
many contacts. Directory-harvested contacts are stored `unverified`; Phase 3's verifier later
updates `verification_status`/`verified_at`/`quality`.

### `contacts` collection

| field               | type     | notes |
|---------------------|----------|-------|
| club                | relation | → `clubs`, required, cascadeDelete |
| email               | text     | **required** — the only required contact field; we never invent it (domain rule #1) |
| name                | text     | contact person, optional |
| position            | text     | role/title, optional (e.g. "President", "Secretary") |
| phone               | text     | optional |
| source_url          | url      | the list/PDF/detail page this contact came from (provenance per contact) |
| verification_status | select   | `unverified` (default for directory harvest) / mx_only / verified / catch_all / undeliverable / unknown |
| verified_at         | date     | null until Phase 3 verifies |
| quality             | select   | A / B / C — computed in Phase 3, null now |
| notes               | text     | |
| created, updated    | autodate | |

- **Unique index on `email`** (global) — outreach-level dedup; find-or-create by email.
- Index on `club`.
- **Domain rule #1 stays sacred:** only persist an email that was deterministically present in
  the source. No pattern-guessed/AI-invented addresses. A contact row without a real email is
  not created (name/phone-only rows are skipped at this stage).

## Extraction changes

- Extend the LLM extraction schema/prompt (HTML + PDF extractors) to additionally return, per
  club, a `contacts` array: `[{email, name, position, phone}]` — email only when literally
  present in the source text; empty array otherwise.
- `Apply & upsert`: after upserting a club, for each contact with a real email →
  find-or-create in `contacts` (by email), set `club`, `source_url`, `verification_status:
  'unverified'`, backfilling name/position/phone without blanking richer existing values.
- Set the club's `status`: `contacts_found` when ≥1 contact saved, else leave as-is.

### Sources, in scope this run
- **List/PDF/HTML columns** (Portugal, Estonia, Czechia, …) — captured inline during extraction.
- **Detail-page contacts** (Bulgaria: contact lives on each club's detail page, not the list) —
  **follow-up sub-step**: a per-club detail fetch+extract, gated, after the list pass. Specced
  here but implemented after the inline path is verified.

## Out of scope
- Email verification (MX/SMTP) and A/B/C quality — Phase 3 proper.
- Brevo push.

## Docs
- Update `CLAUDE.md` `contacts` table (rename `role`→`position`, add `phone`) and note that
  contacts are now seeded during Phase-2 extraction when the directory exposes them.
