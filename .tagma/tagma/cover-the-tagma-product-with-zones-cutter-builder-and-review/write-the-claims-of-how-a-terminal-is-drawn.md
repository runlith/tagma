---
id: 01a0ca95-3114-7241-ac1e-73c02a80f5da
title: Write the claims of how a terminal is drawn
ord: 189
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
The area is [[2739a187]], about 4,700 lines over ten files.

Read every file the area sources, whole, with its adjacent tests: `terminalLinks.ts` (1,130 lines), `TerminalScrollIntent.svelte.ts` (965), `TerminalFit.ts`, `TerminalRenderPolicy.ts`, `TerminalRenderer.ts`, `TerminalAppearance.svelte.ts`, `TerminalGrids.svelte.ts`, `TerminalSearch.svelte`, `TerminalLinkTip.svelte`, `terminal.css`. Load the `svelte5` skill first.

The subject is what a pane looks like and what decides it: the one GPU verdict and glyph atlas every pane shares, the fit from pixels to rows and columns, the look applied live from a settings section, the scroll the reader intended as against the one output caused, and what in the output is a link. Three of these owners are one per page rather than one per pane, and why each is page-wide is stated in `terminals.layer.ts` — read that before claiming a scope.

What a pane IS belongs to [[fe4e48f2]] and another task. The module above is [[cc59eadf]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over these paths is clean, and a review passes.