# Modal (Dialog) UI pattern

## Goal

Introduce a reusable modal/dialog primitive as a first-class UI pattern, and use it to
replace the inline collapsible detail block on the Federations list. Individual federation
details open in a centered modal with a header row (federation name) and a nicely organized
field set.

## Decisions

- **Hand-rolled, no new deps.** Matches the existing component convention (`Tooltip` is a
  lightweight JS-driven primitive, not Radix). Build `src/components/ui/dialog.tsx` using a
  portal-free fixed overlay. No `@radix-ui/*` packages — keeps the bundle and setup minimal,
  consistent with the rest of `src/components/ui`.
- **Trigger:** clicking a federation row (the code/name cells) opens the modal. This replaces
  the previous expand/collapse toggle. The `openId` state in `FederationsPage` now drives the
  modal instead of an inline expanded `<TR>`.
- **Close affordances:** backdrop click, an `×` button in the header, and the `Escape` key.
- **Body scroll lock** while a modal is open.
- **Layout:** header row = federation name (+ `fivb_code` mono, confederation badge, status
  badge) with a close button on the right. Body = a two-column definition grid of fields,
  grouped into logical sections (Overview / Contacts / Directory). Footer holds the
  trigger-result feedback line (Detect directory / Extract clubs outcome) when present.
- **Actions stay in the table row.** The Detect directory / Extract clubs icon buttons remain
  in the Actions column; the modal is read-only detail. The trigger-result message (which used
  to live in the collapsible) now renders in the modal footer so it stays available.

## Files

- **New** `src/components/ui/dialog.tsx` — `Dialog` primitive:
  - Props: `open: boolean`, `onClose: () => void`, `title?: ReactNode`,
    `header?: ReactNode` (full custom header row; overrides `title`), `children`,
    `className?` (sizing override), `footer?: ReactNode`.
  - Renders a fixed inset overlay (semi-opaque backdrop) + centered panel. Escape-to-close
    and body scroll-lock via `useEffect`. Returns `null` when `!open`.
  - Exports `Dialog` (and small `DialogField` helper for the label/value grid rows, reused
    from the old `Detail`).
- **Edit** `src/features/federations/FederationsPage.tsx`:
  - Remove the inline expanded `<TR>` detail block.
  - Replace it with a `<FederationDetailDialog>` rendered once, controlled by `openId`.
  - Row click sets `openId`; modal `onClose` clears it.
  - Move `Detail` → reuse the dialog's field helper (or keep a local `Field`).
  - Trigger-result feedback renders in the dialog footer.

## App-wide rollout (consistency pass)

After the Federations detail modal landed, the same pattern was applied across the app so
every overlay shares one look:

- **New** `src/components/ui/confirm.tsx` — `useConfirm()` hook returning `{ confirm, confirmElement }`.
  `confirm(opts): Promise<boolean>` opens a styled confirm modal (built on `Dialog`) and
  resolves on Confirm/Cancel. Replaces the native `window.confirm()` popups. Options:
  `title`, `message`, `confirmLabel`, `cancelLabel`, `destructive`.
  - `FederationsPage.batchProcess` and `ClubsPage.resolveWebsites` now use it instead of
    `window.confirm`.
- **Club detail modal** — `ClubsPage` gets `openId` state; clicking a club's name opens a
  `ClubDetailDialog` (header = club name + status/confidence badges; sections Location /
  Website / Provenance).
- **Contact detail modal** — `ContactsPage` gets `openId` state; clicking a contact's email
  opens a `ContactDetailDialog` (header = email + verification badge; sections Club /
  Contact / Provenance).

## Out of scope

- Animations beyond a simple fade (kept minimal; can add later).
