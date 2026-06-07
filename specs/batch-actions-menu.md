# Spec: Group batch actions under a three-dots (kebab) menu

The list toolbars render their batch actions as a row of inline `Button`s
(clubs has five; federations one). As the action set grew this crowds the toolbar. Move every
list-level batch action into a single kebab (⋮) menu at the right of the toolbar.

This is presentation-only: the actions, their counts, confirms, and n8n triggers are unchanged
— only how they're surfaced changes.

## Decisions (from interactive Q&A)

1. **Menu item style: label + count + description.** Each item shows the action name, its live
   count as `(N)` (where applicable), and a one-line description underneath — preserving the
   explanatory text (incl. credit-spend warnings) that lives in today's per-button tooltips.
2. **One kebab per list, even for a single action** (federations has only "Process"); the point
   is a consistent home for batch actions. Lists with **no** batch actions (contacts) get **no**
   kebab.
3. Also: rename the clubs **"Englishize names"** action to **"Romanize names"** (label only).

## New component — `src/components/ui/menu.tsx`

`ActionsMenu` — a kebab button that opens a dropdown of actions.

```ts
interface MenuAction { key: string; label: string; description?: string; count?: number; disabled?: boolean; onSelect: () => void }
ActionsMenu({ actions: MenuAction[]; label?: string; busy?: boolean; align?: 'left' | 'right' })
```

- Kebab trigger is an icon button (matches `Button` outline styling, 8×8). Shows a spinner when
  `busy`.
- Panel: each action is a full-width menu item — top row `label` + right-aligned `(count)`,
  second row the muted `description`. Disabled items are dimmed and non-clicking. Selecting an
  item closes the menu then runs `onSelect`.
- Closes on outside click (`mousedown`) and `Escape`. `role="menu"` / `menuitem`,
  `aria-haspopup`/`aria-expanded`.

## File-level changes

- **`src/features/clubs/ClubsPage.tsx`** — replace the five `Tooltip`+`Button` blocks with one
  `<ActionsMenu busy={enrichBusy} actions={[…]} />`: Resolve unresolved `(unresolvedCount)`,
  Re-resolve all `(totalItems)`, Re-check confidence `(recheckCount)`, Harvest all live
  `(harvestCount)`, Romanize names (no count). Each `disabled` keeps its current condition;
  descriptions are concise versions of the existing tooltip copy. Rename Englishize→Romanize in
  the item label.
- **`src/features/federations/FederationsPage.tsx`** — replace the "Process N" `Tooltip`+`Button`
  with one `<ActionsMenu busy={batchBusy} actions={[{ Process federations, count: totalItems, … }]} />`.
- **No change** to contacts (no batch actions) or to any trigger/confirm logic.

## Out of scope
- Per-row action buttons (federations' discover/extract icons) — those stay inline; this is only
  about **list-level** batch actions.
- Any change to n8n triggers, counts, or confirm dialogs.
