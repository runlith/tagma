---
id: 01a0ca95-3133-71a5-aa91-f771d756c19b
title: Write the claims of the chrome around every surface
ord: 196
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
The area is [[4ac333a6]]; read `apps/tagma/app/src/lib/features/frame` whole, with its three tests, and read `src/routes/+layout.svelte` beside it — the frame is mounted there and the two only make sense together. Load the `svelte5` skill first.

The subject is what stands around whatever surface is open: the top bar, the navigation rail, the knowledge index beside a reading column and the width at which it fits, the status bar carrying the wire's state and the operator's spend, the command palette, and what keeps the machine awake while work is running. `StandingChip.svelte` is 348 lines and is the densest thing here.

The frame is the last folder before the composition root, so it may read every feature; that is the folder order's doing and [[e3e9376a]] already carries it.

The module above is [[cc59eadf]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over `apps/tagma/app/src/lib/features/frame` is clean, and a review passes.