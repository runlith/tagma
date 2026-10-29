---
id: 01a0ca95-3110-7218-b8d2-e9ecd5f021b1
title: Write the claims of what one terminal pane is
ord: 188
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
The area is [[fe4e48f2]], about 7,400 lines over nine files — the largest single reading in this module.

Read every file the area sources, whole, with its adjacent tests: `TerminalInput.ts` (1,709 lines), `TerminalOutput.ts` (1,335), `TerminalPane.svelte.ts` (1,312), `TerminalKeymap.ts`, `engineGuards.ts`, `terminalEngine.ts`, `RecordStream.svelte.ts`, `TerminalRetention.ts`, `terminalTabFocus.ts`. Load the `svelte5` skill first: `.svelte.ts` files hold runes and what a model recalls about Svelte is wrong here.

The subject is one live terminal: the engine, the retained record replayed and then followed live from exactly where the replay ended, the chord table a keystroke is resolved against, and the scheduling that decides which engine is written into next. What xterm does is not this package's claim except where this code decides something about it. How a pane LOOKS is [[2739a187]] and another task's.

The module above is [[cc59eadf]]; the execution protocol is [[6c81c6f3]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over these paths is clean, and a review passes.