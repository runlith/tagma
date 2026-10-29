---
id: 01a0ca95-312f-731e-afdf-7a42151cc250
title: Write the claims of the checkout on screen
ord: 195
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
The area is [[86cb89e4]]; read `apps/tagma/app/src/lib/features/checkout` whole, with its nine tests. Load the `svelte5` skill first.

The subject is a working tree several sessions write at once: which paths moved, what a diff says, and whose hand wrote each line — `authoredHunks.ts`, `handHues.ts` and `LineHolder.svelte` are where authorship becomes something on screen, and the per-thread file column exists because holding is not owning. Be careful with what the evidence establishes: a change record attributes a write, a shell observation only says bytes moved, and a claim here must not promise the stronger of the two.

The module above is [[cc59eadf]]; the git kit is [[adeeb4ba]] and is the reference shape for this whole cover as well as the owner of what a diff IS. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over `apps/tagma/app/src/lib/features/checkout` is clean, and a review passes.