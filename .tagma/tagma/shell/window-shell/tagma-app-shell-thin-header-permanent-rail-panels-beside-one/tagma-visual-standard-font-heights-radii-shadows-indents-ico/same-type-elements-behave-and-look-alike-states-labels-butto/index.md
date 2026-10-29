---
id: 01a10937-6ddd-7b5a-a22f-0bf00eb99afb
title: "Same-type elements behave and look alike: states, labels, buttons, color values, layout of menus, popups, cards and dialogs"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui
  - kind: dir
    ref: checks/law/ui-tokens
---
Same-type app elements behave and look the same: one hover state, one selected, one focus ring, labels in normal case, one primary button per surface, one color — one value, shared layout for menus, popups, cards, dialogs and tooltips. A commit-time check catches extra variants.

Operator decision 2026-10-04 on the operator's word (“fix everything, bring it to a normal look”). The first pass reconciled numbers — sizes, radii, shadows, indents, color literals. Same-type elements still behaved and looked different. Code measurement after the first pass:
- about ten hover backgrounds: `bg-accent`, `bg-muted`, `bg-accent/60`, `/50`, `/40`, `foreground/10`, `foreground/8`, `input/50`, `background/70`, `muted/70`;
- a selected menu item is `accent` here, `muted` there;
- section labels in caps with tracking in 5 files (“YOU ARE IN”) next to normal case (“Current”);
- `tracking-*` in 18 places;
- in the thread card the brightest button is the secondary “Compact”;
- orange in the model menu means “Max”, favorite, and quota alike;
- popups laid out differently.

**States — one token each.**
- Hover on a neutral interactive element (row, ghost button, menu item, chip) — `bg-hover`.
- Selected, keyboard-highlighted and open trigger — `bg-selected`.
- Hover on a dangerous action — `bg-hover-danger`.
- Focus — one `ring-2 ring-ring` ring with offset, `focus-visible` only.
- Disabled — `opacity-50`, no hover.
- The `--hover`, `--selected` and `--hover-danger` tokens are set in both themes. No other hover or selection backgrounds exist.

**Section labels** — normal case, `text-small` 600, muted color. `uppercase` and `tracking-*` are not used. Exceptions are `kbd` and mono identifiers where unavoidable; each named in the check parameters.

**Buttons.**
- Primary (filled) — at most one per surface, and only for that surface's main action.
- Secondary — outline.
- Tertiary and icon — ghost.
- Dangerous — red text or outline. Red fill — only in the confirmation dialog.

**One color — one value.**
- Brand yellow — active nav item and selected marker.
- Blue — waiting and links.
- Green — success and done.
- Amber — warning and “in work”.
- Red — failure and dangerous action.

Everything else is neutral. Favorites are marked by shape (icon), not state color. “Max” in the model menu stays orange — the operator's word.

**Surface layout.**
- **Menu.** 28-high items, 14 icon on the left, chord on the right muted `text-meta`, dividers, section labels per the rule above.
- **Popup with search.** First row — a borderless search field with icon, divided by a line. Then sections with labels. With keyboard navigation — a hints row at the bottom, `text-meta`.
- **Info card** (peek, build, load):
  - title row `text-ui` 600;
  - meta row `text-small` muted;
  - “label — value” list, labels `text-small` muted;
  - action row at the bottom: secondary buttons; primary only with a clear main action.
- **Dialog.**
  - Title `text-page`, description muted `text-ui`, body.
  - Actions bottom right: primary far right, cancel left of it.
  - `shadow-float`, `rounded-lg`, widths from the token set.
- **Tooltip.** `text-small`, `rounded-md`, `--popover` tone.
- **Tone and border.** Popups, menus, cards and dialogs stand on `--popover` with a `--border` border. Popups and menus — `shadow-raised`, dialogs — `shadow-float`. Radius 18 — only the composer and its popups, as written above.

**Light theme** follows the same rules as dark, including chat and composer.

**Check.** It extends to state families:
- `hover:bg-*`, `data-[highlighted]`, `data-[state=open]`, `aria-selected` and `data-[selected]` with background — only `bg-hover`, `bg-selected` and `bg-hover-danger`;
- `uppercase` and `tracking-*` — only in the named exceptions.

**Acceptance of this part.**
- The check with the new families is clean, debt 0.
- The operator views the result in their own app; agents do not launch a browser.
