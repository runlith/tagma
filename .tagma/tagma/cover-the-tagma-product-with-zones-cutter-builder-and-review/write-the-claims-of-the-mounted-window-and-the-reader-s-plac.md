---
id: 01a0ca5e-429e-77d8-990d-ccbd977f9223
title: Write the claims of the mounted window and the reader's place in it
ord: 155
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
Read `packages/chat-ui/src/TranscriptVirtualizer.svelte.ts`, `TranscriptViewport.svelte.ts`, `transcriptCursor.ts`, `transcriptMessageNavigation.ts`, `transcriptNavigation.ts`, with their four test files beside them. Write the claims under [[e8a94e5d]]; the module is [[cb732496]].

Several figures here are carried unmeasured from the implementation this was read against — a cursor offset, a head reach, a gesture window. State each as what it is; an inherited constant with no measurement behind it is a limitation to claim, not a reason to stay silent. The auto-follow half that is not about messages belongs to `@runlith/scroll-follow` [[fe46cdea]]: read its claims before restating them here.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. This is Svelte 5: load the `svelte5` skill first. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.