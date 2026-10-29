---
id: 01a17ac2-3a5a-7b4c-be38-672fa66babc3
title: "Terminal search matches are painted from the panel theme: the current one gold, the rest neutral"
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a17ab6-79f8-7a22-a439-1a3169a45344
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/canvasInk.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Search.svelte
---
Terminal search paints matches with the `SEARCH_DECORATIONS` constant (`terminal/canvasInk.ts`): all matches and their ruler marks are yellow-gold, the current one orange, the same hex on any theme, light or dark. By Tagma grammar only "you are here" is marked gold — the current match, the rest are neutral, as in the editor.

To do: derive the search paints from the panel theme, which `TerminalAppearance` already hands to `Pane.applyTheme`, and pass them into `Search.svelte`. Other matches are a blend of the theme background and text, the current one is Tagma gold (the `cursor` of the Tagma Dark or Light theme per slot) as a frame with a faint fill. xterm takes only `#RRGGBB` for fills, so the blend is computed in hex. A theme switch recomputes the paints of the open search.
