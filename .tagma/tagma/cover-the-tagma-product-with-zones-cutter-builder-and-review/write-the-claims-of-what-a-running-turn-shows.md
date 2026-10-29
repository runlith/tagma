---
id: 01a0ca5e-42a9-7778-b540-a5e03b26d905
title: Write the claims of what a running turn shows
ord: 157
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Read `packages/chat-ui/src/liveStatus.ts` with `liveStatus.test.ts`, and `LiveLabel.svelte`, `LiveRunRow.svelte`, `RunClocks.svelte`, `RunEndRow.svelte`, `RunEndingStrip.svelte`. Write the claims under [[b1af5811]]; the module is [[cb732496]].

What is claimable: which facts decide the phase and in what order, which entries count as live and by what reading of their own state, and which run endings leave work a reader can take up. The server's own liveness measurement belongs to [[d1caad35]] — nothing here recomputes it, and saying so is a claim.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. This is Svelte 5: load the `svelte5` skill first. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.