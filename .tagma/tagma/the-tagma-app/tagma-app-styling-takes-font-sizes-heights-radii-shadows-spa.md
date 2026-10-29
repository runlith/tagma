---
id: 01a108a9-89cf-7f17-9b45-3b4c55b5437b
title: Tagma app styling takes font sizes, heights, radii, shadows, spacing, icons and colors only from the standard tokens
ord: 54
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "ui-tokens",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
edges:
  - kind: relates
    to: 01a10891-853e-7f52-89f5-9e2869cfbc5c
sources:
  - kind: dir
    ref: apps/tagma/app/src
  - kind: dir
    ref: packages/chat-ui/src
  - kind: dir
    ref: packages/primitives/src
---
No classes or values outside the token set are written: no arbitrary `[…]`, no default Tailwind names, no composed names (`text-${x}`).

- **Font:** `text-meta`, `-small`, `-ui`, `-body`, `-page`, `-title`; `text-badge` — only the counter digit on the icon; all other `text-*` — only a color token, alignment and wrapping.
- **Radii:** `rounded-sm`, `-md`, `-lg`, `-full`, `-none`; bare `rounded` and other names are forbidden.
- **Shadows:** `shadow-raised`, `shadow-float`, `shadow-none`.
- **Spacing** (padding, margin, gap, space): steps 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16; `px` — for dividers, `auto` — for margins.
- **States:** backgrounds under `hover:`, `data-highlighted`, `data-[state=open]`, `aria-selected` and `data-selected` — only `bg-hover`, `bg-selected`, `bg-hover-danger`, with no transparency.
- **Surfaces:** backgrounds — `chrome`, `field`, `background`, `raised`, `popover`, `sunken`; selection and chips — `bg-hover` and `bg-selected` overlays, `muted` and `accent` are never taken as backgrounds.
- **Case:** `uppercase`, `tracking-*`, `text-transform: uppercase` and non-zero `letter-spacing` are never written.
- **Icons:** every icon component carries an explicit `size-3`, `size-3.5` or `size-4` in its `class` attribute.
- **Color:** tokens only; the Tailwind palette (`bg-red-500`, `bg-black/10`), named colors and literals (hex, `rgb()`, `hsl()`, `oklch()`) are allowed only in token files and in palette files named in the inspection parameters.
- **Declarations** in `<style>`, `.css` and `style=`: `font-size`, radii, `box-shadow`, spacing and offsets take their values from tokens (`var(--text-ui)`, `var(--radius-md)`, `calc(var(--spacing) * 2)`); only `0`, `1px` and `box-shadow` rings up to `2px` remain literals.
