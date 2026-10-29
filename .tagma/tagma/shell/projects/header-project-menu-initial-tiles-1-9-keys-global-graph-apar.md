---
id: 01a15185-dd68-7ffb-946f-032ab87240b2
title: "Header project menu: initial tiles, ⌘1–⌘9 keys, global graph apart, no storage labels, search from eight projects up"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15185-fa6e-706e-bfef-2916304d92a4",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/ProjectList.svelte
---
The operator accepted variant B from http://localhost:5634/a/ab6d709207b7 plus search from variant C for those with eight projects or more. The menu is `apps/tagma/app/src/lib/app/chrome/ProjectList.svelte`.

- **Row.** The color square becomes an initial tile (`Tile`, small size), because eight shades by `id % 8` repeat. The storage label goes away; the mode stays in the row tooltip. One slot on the right: the current project gets a checkmark, on hover an “open in new window” button — instead of two invisible slots that now leave an empty gap. Working agents’ pulse must not read as project color.
- **Keys.** On the right, the chord that already opens the project (`chordOf`).
- **Global graph** (`global`) — its own row on top with a separator.
- **Search** — from eight projects up: focused field on open, name filter, Enter opens the first; “Recent” (from `Visits`) and “All” sections.

Proof: the menu in the app in both themes, `bun run typecheck`, tests of the affected components.
