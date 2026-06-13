# Reoon verification — switch to the bulk API

> Refactor of the `verify-contacts-reoon` n8n workflow. Supersedes the per-email real-time
> loop described in `specs/brevo-reoon-integration.md` §"1. `verify-contacts-reoon`". The
> selection rules, the A/B/C mapping, and the `job_runs` instrumentation are unchanged; only
> **how we call Reoon** changes.

## Problem (why we changed)

The old flow called Reoon's **real-time single-email** endpoint
(`/api/v1/verify?email=…&mode=power`) once per contact, fired as fast as n8n could inside a
`splitInBatches` loop of 100 with **no throttle, no retry**, and `onError:
continueRegularOutput`.

Diagnosed from live executions:

- Reoon **rate-limited** us — responses were literally `HTTP 429 "Try spacing your requests
  out using the batching settings under 'Options'"`.
- Power mode does a live SMTP probe that often takes **>30 s**, so many calls hit the node's
  30 s **timeout**.
- Both failures flowed downstream as error items, and `Write back`'s `mapStatus()` turned any
  unrecognized response into **`unknown`** with `verified_at = now`. So a rate-limited or
  timed-out email was **silently recorded as "checked → unknown"**.
- `Pick contacts` excludes `unknown` from the cooldown set, so the next run **re-picked all
  unknowns** and hammered Reoon again → same 429s → same unknowns. Net: each run "really"
  verified only the handful that squeaked through before the limit; the rest churned as
  `unknown` forever. (In one 20k-email run, **11,579 responses were 429/timeout errors**, all
  written as `unknown`.)

## Decision

Use Reoon's **bulk verification API** instead of the real-time endpoint. Bulk is built for
volume: submit one task with up to **50,000 emails**, Reoon verifies them all in **power mode**
server-side (no per-request rate limit), and we poll for the result. (Agreed via questionnaire:
"Switch to Reoon bulk API".)

This removes the 429/timeout class of failures entirely, so `unknown` now means a *genuine*
Reoon "couldn't determine" result — not a transient throttle.

## Reoon bulk API contract (verbatim)

**Create** — `POST https://emailverifier.reoon.com/api/v1/create-bulk-verification-task/`,
`Content-Type: application/json`, body `{ "name", "emails": [...], "key" }`.
Response `201`: `{ "status":"success", "task_id", "count_submitted",
"count_duplicates_removed", "count_rejected_emails", "count_processing" }`.

**Poll** — `GET https://emailverifier.reoon.com/api/v1/get-result-bulk-verification-task/?key=…&task_id=…`.
Response top-level: `task_id, name, status, count_total, count_checked, progress_percentage,
results`. Task `status` ∈ `waiting | running | completed | file_not_found |
file_loading_error`. `results` is an **object keyed by email address**; each value has
`status, is_safe_to_send, can_connect_smtp, is_deliverable, is_catch_all, is_role_account, …`.
Per-email `status` ∈ `safe | invalid | disabled | disposable | inbox_full | catch_all |
role_account | spamtrap | unknown`.

Auth: the **create** endpoint reads the key from the **JSON body only** — a query-string key
is rejected (`"API key not provided"`, verified live). n8n's stock query-auth credential can't
put a secret in a POST body, so we use a dedicated **`Reoon (bulk)` Custom Auth credential**
(`httpCustomAuth`) configured to inject the key into **both** the body (for create) and the
query (for poll):

```json
{ "qs": { "key": "<REOON_KEY>" }, "body": { "key": "<REOON_KEY>" } }
```

Both Reoon HTTP nodes use this one credential (`genericAuthType: httpCustomAuth`). For the
body-merge to land, **Create task** sends its body as an object expression
(`={{ { name: $json.name, emails: $json.emails } }}`, not a stringified JSON) so n8n merges the
credential's `body.key` into it. The key stays entirely inside n8n (secrets convention upheld);
the committed export carries a `REPLACE_REOON_CRED` placeholder id, swapped for the live
credential id at PUT time.

## New workflow shape (`verify-contacts-reoon`)

```
Webhook → Respond → Config → PB Auth → Pick contacts → Create task → Wait → Get result
                                                                              │
                                                              Poll tick → IF done?
                                                              ├─ false → (loop back to) Wait
                                                              └─ true  → Write back → Finish
```

- **Pick contacts** (Code) — unchanged selection: `ids` → those records; else page `contacts`
  by `body.filter`; dedup by email; drop `blocklisted`; skip settled
  (`verified|undeliverable|catch_all`) verified within `reverify_days` unless `force`. Then:
  build the `emails[]` list + an `email→id` map (stored in `$getWorkflowStaticData('global')`),
  **open the `job_runs` row** (total = #emails), and emit one item `{ name, emails }`. Caps at
  50,000 emails/task (logs `truncated` if more — our total contact count is well under this, so
  a single task covers a full re-verify). Empty selection → close the job `done` and return `[]`
  (self-short-circuits, like `sync-contacts-brevo`).
- **Create task** (HTTP POST) — submits `{ name, emails }`; key via the query-auth credential.
  Returns `task_id`.
- **Wait** (Wait node, 20 s `timeInterval`) — the poll cadence. n8n persists+resumes the
  execution across the wait, so no worker is held hot.
- **Get result** (HTTP GET) — `task_id` from `Create task`; key via the credential.
- **Poll tick** (Code) — heartbeat `job_runs.processed = count_checked` (and real `total =
  count_total`); `done = status==='completed'` or a terminal failure or the poll cap (180 polls
  ≈ 60 min) is hit; passes `{ done, failed, results }` through.
- **IF done?** — `false` loops back to **Wait**; `true` proceeds to **Write back**.
- **Write back** (Code) — for each email in `results`, map the full per-email result →
  `verification_status` (`mapStatus`: `safe|role_account→verified`, `catch_all→catch_all`,
  `invalid|disabled|disposable|spamtrap|inbox_full→undeliverable`; **`unknown` + `mx_accepts_mail`
  + valid syntax → `mx_only`** ("Unable to verify"); else `unknown`), look up the contact id from
  the `email→id` map, and PATCH `{verification_status, verified_at}` in concurrency-25 chunks.
  Emails Reoon rejected at submit (bad syntax) never appear in `results` and are left untouched.
- **Finish** (Code) — set `settings.reoon.last_run`, close the `job_runs` row (`done`, or
  `error` if the task never completed).

### Behaviour notes
- **`mx_only` = "Unable to verify" (sendable).** ~95% of Reoon's `unknown` verdicts are really
  "the domain accepts mail + the address is well-formed, but the provider blocks the SMTP probe"
  (freemail/ISP: `wp.pl`, `t-online.de`, `outlook.fr`, …). Those addresses are almost all real,
  so we map them to `mx_only` (labelled "Unable to verify" in the UI) and **include them in the
  Brevo gate** rather than discard real leads. Only genuine `unknown` (no MX / malformed) stays
  excluded. `mx_only` is also a **settled** state for the re-verify cooldown (re-running won't
  re-spend on it — the verdict won't change). See `specs/brevo-reoon-integration.md` §2.
- `settings.reoon.mode` is now **moot** — bulk always runs power mode. `reverify_days` still
  applies to the settled-cooldown skip (now `verified|undeliverable|catch_all|mx_only`).
- The 429/timeout-as-`unknown` data pollution is gone. The existing ~2,000 `unknown` contacts
  (many of which were really just rate-limited) will resolve to real statuses on the next run.
- **Concurrency caveat:** run state (`jobId`, `email→id` map, poll counter) lives in the
  workflow's *global* `staticData`, so two simultaneous verify runs would clobber each other.
  Verification is a manual, infrequent action, so this is accepted (same assumption the old
  flow already made for `verifyJobId`).

## Out of scope
- Chunking >50k into multiple parallel tasks (not needed at current scale; capped + logged).
- Auto-scheduling verification (still a manual button, decision #1 in the Brevo/Reoon spec).
- A re-verify cooldown for `unknown` (left always-eligible so the post-migration re-run can
  clear the historically-polluted unknowns; revisit if credit spend becomes a concern).
