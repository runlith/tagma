---
id: 01a0ca5e-4293-72e0-940a-56f1906e01dd
title: Write the claims of what a row is worth before anything measures it
ord: 153
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
Read `packages/chat-ui/src/rowEstimate.ts` with `rowEstimate.test.ts` beside it, and the class lists of the rows it estimates for. Write the claims under [[5afb39ee]]; the module is [[cb732496]].

Every figure here claims to be composed from line boxes and paddings written in a row's own class list rather than chosen. Check that against the markup before restating it: a figure that no longer matches the row it was composed from is the claim worth writing, as a limitation.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.