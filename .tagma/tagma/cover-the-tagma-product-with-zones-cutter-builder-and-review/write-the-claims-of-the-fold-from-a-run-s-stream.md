---
id: 01a0ca5e-4289-7a5d-b2b7-9fd97782f8d3
title: Write the claims of the fold from a run's stream
ord: 151
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
Read `packages/chat-ui/src/ChatFold.svelte.ts` with `ChatFold.svelte.test.ts` beside it. Write the claims under [[538b45a3]]; the module is [[cb732496]].

This is the reactive owner: what a snapshot replaces, what a live message amends in place, what an interruption, a rollback or a superseded run takes back, and where words no run has read yet are placed. The kernel's own transcript-fold claims under [[d1caad35]] are the neighbouring truth — read them before restating anything they already hold.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. This is Svelte 5: load the `svelte5` skill before reading a `.svelte.ts` file, so runes are read as what they are. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.