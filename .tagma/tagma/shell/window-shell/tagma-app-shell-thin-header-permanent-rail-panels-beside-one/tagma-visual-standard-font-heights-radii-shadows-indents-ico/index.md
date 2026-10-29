---
id: 01a10891-853e-7f52-89f5-9e2869cfbc5c
title: "Tagma visual standard: font, heights, radii, shadows, indents, icons and colors only from tokens, with a commit-time check"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui
  - kind: file
    ref: apps/tagma/app/src/app.css
  - kind: file
    ref: packages/chat-ui/src/theme.css
---
All app visuals take font sizes, heights, radii, shadows, indents, icons and colors from one token set. A commit-time check rejects values outside the set. The interface looks made by one hand, and panels differ by tone, not just lines.

## What is there now

Measurement of 2026-10-04 over `apps/tagma/app/src`, `packages/chat-ui/src` and `packages/primitives/src`: 722 files without tests, class occurrences counted.
- **Font.** 1069 size classes, of which 577 arbitrary `text-[…]` in 23 values, about 28 effective sizes. The `text-h3` class in `SettingsPage.svelte` is dead: no such token exists.
- **Radii.** 13 effective values. Bare `rounded` is a fixed 4 px; there are also `rounded-2xl` 16 px and 43 arbitrary values.
- **Shadows.** Six Tailwind names land on four elevation levels. Dialog has no shadow at all.
- **Strip heights:** 24, 32, 40, 44 and 52 px.
- **Indents.** 34% of classes are half-steps: 2, 6, 10, 14 px; 53 more arbitrary values.
- **Colors outside tokens:** terminal palettes, markdown syntax, file-type colors, 30 `rgb()` in terminal CSS.
- **Tone.** Chrome lighter than content in both themes: in dark `--rail` .215 vs `--background` .185.
- **Token duplicates:** 10 copies of `--sidebar-*`, `--secondary` ≡ `--muted`, a second `--chat-*` set.
- **Page titles** of five kinds and three content widths.

## Standard

**Font — six sizes.** Default Tailwind sizes reset (`--text-*: initial` in `@theme`), so no other names exist.
| token | px | for |
|---|---|---|
| `text-meta` | 11 | mono: hashes, time, counters, `stamp` |
| `text-small` | 12 | secondary text, chips, labels, `eyebrow` |
| `text-ui` | 13 | lists, buttons, fields, panel titles |
| `text-body` | 14 | messages, block body, settings descriptions |
| `text-page` | 17 | section title, dialog title |
| `text-title` | 22 | page title |

Current values map by element role, not nearest number. Markdown headings: h1 17, h2 and h3 — 14 and 13 bold.

**Heights.**
- Strips: 36 header, 32 panel title, 24 status bar.
- Controls: 24 — compact (chips, icon buttons in titles), 28 — regular (buttons, fields, list rows, menu items), 32 — dialog primary buttons.
- shadcn button: `xs` 24, `sm` 28, `default` 32; `Input` and `Select` default 28.
- Every height has one source. A TS constant exists only where a script needs the number, like `STATUS_BAR_HEIGHT`, and CSS takes it from there.

**Radii — by role.**
- `rounded-sm` 4 — small print inside text: tags, `kbd`, code, badges.
- `rounded-md` 6 — controls: buttons, fields, rows, menu items.
- `rounded-lg` 10 — containers: cards, popups, menus, dialogs, composer, notifications.
- `rounded-full` — dots, avatars and pills only.
- Bare `rounded`, `rounded-xs`, `-xl`, `-2xl` and arbitrary values go away.

**Shadows — three levels.**
- No shadow — everything lying in layout, including inputs: shadcn's `shadow-xs` goes away.
- `shadow-raised` — menus, popups, dropdowns, tooltips, peek cards.
- `shadow-float` — dialogs, notifications, image view.

Four elevation tokens collapse to two.

**Indents.** Scale steps: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16 — i.e. 0–64 px. A 4 px grid underneath; small steps 2 and 6 remain for dense rows — without them lists would have to bloat. Steps 2.5, 3.5 and arbitrary values go. 1 px remains only for borders, rings and dividers.

**Icons.** 12 — inside chips and meta, 14 — default, 16 — rail, header and empty states. Every icon has an explicit size class.

**Color.**
- Tokens only. Literals allowed in token files and data palettes: `shared/terminalThemes.ts`, syntax in `graph/markdown-body.css`, `shared/FileIcon.svelte`, canvas fallbacks in `packages/chat-ui/src/entries/DiffMap.svelte` and `packages/chat-ui/src/draftImages.ts`. Each file named in the check parameters with one “why” line.
- Terminal chrome moves to tokens: `PaneTree`, `Search`, `Toast`, `LinkTip`, `ExitOverlay`, `TabStrip`, `threads/external/Terminal.svelte`.

**Tone ladder in both themes.**
- Tokens: `--chrome` (header, rail, columns, status bar), `--background` (content), `--raised` (composer, cards), `--popover`, `--accent` (hover and selected), `--sunken` (code, inputs).
- Dark theme (L oklch): chrome .165 < background .198 < raised .238 < popover .258 < accent .29; sunken .15.
- Light: chrome .965 < background .99 < raised 1.0; popover 1.0 with `shadow-raised`; accent .945; sunken .955.
- These are starting values: the operator views the result.
- `--rail`, `--sidebar` and all `--sidebar-*` become `--chrome`; `--secondary` becomes `--muted`.

**Semantic colors.**
- Object type shows a monochrome `TagIcon` (already done); state shows a `--status-*` dot color.
- `--tag-*` used only on the graph canvas. Their hues move away from status hues: tasks off amber, rules off red.

**Page title.**
- One `PageHeader` component:
  - title `text-title`;
  - optional caption muted `text-ui`;
  - actions slot;
  - optional `ScopeChip`.
- Two widths. Reading — 46rem, for the block page. Wide — full width with 32 px margins and an 80rem max, for Journal, Rules, Settings and the Worktrees board.

## How it is built

- **Tokens** live in `apps/tagma/app/src/app.css` (`:root`, `.dark`, `@theme inline`) and reset default Tailwind families: `--text-*`, `--radius-*`, `--shadow-*`. `packages/chat-ui/src/theme.css` is the package's contract for other apps: its default names and values stay, Tagma overrides them in `app.css`, as now.
- **shadcn components** in `lib/shared/ui` are generated and edited in place to the standard: button and field sizes, radii, shadows, focus rings.
- **Migration** goes by family: font, radii, shadows, indents, heights, icons, colors. A script does the mechanical part; its command names files in `produces`. Where the role is ambiguous, the implementer decides from the screenshot.
- **File size limit.** `StandingChip.svelte` (830 lines) and `BlockPage.svelte` (756) are above the 650-line limit, so changes in them may only shrink the file.
- **Check** — a new law-check in the `checks/law` program, runner `runlith-law` from `checks/runners.json`.
  - It picks `.svelte`, `.ts` and `.css` in the three directories above.
  - Refuses a class outside the set for the text, rounded, shadow, indent and icon-size families.
  - Refuses any `[…]` in those families.
  - Refuses a color literal outside the allowed files.
  - Parameters — allowed names and the exception-file list with “why”.
- **Rule.** A new `#rule` node in the graph: “Tagma app visuals take font sizes, heights, radii, shadows, indents, icons and colors only from the standard's tokens”. Enabled via `enforce_rule` at gate (`submit_work`, `merge_worktree`) right after migration. Debt at enablement is zero; whatever remains is named with an owner.

## Acceptance

- The check is clean over its whole area, the rule enabled at gate.
- Typecheck and tests pass.
- One-off DOM scan in a headless browser per section:
  - effective font sizes ⊆ {11, 12, 13, 14, 17, 22};
  - radii ⊆ {0, 4, 6, 10, full};
  - shadows ⊆ {none, raised, float}.
- Before-and-after shots of every section in both themes shown to the operator.

## Out

- New palette, accent color and fonts.
- Terminal theme colors and syntax highlighting. That is data, named in the exceptions.
