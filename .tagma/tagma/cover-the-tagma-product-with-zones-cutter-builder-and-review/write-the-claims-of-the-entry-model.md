---
id: 01a0ca5e-427d-7b8b-acf6-2945733f8b46
title: Write the claims of the entry model
ord: 150
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
Read `packages/chat-ui/src/entries.ts` and `errorText.ts`, and the kernel doors they project from — `@runlith/agent/protocol`, `/transcript`, `/fold`, `/tool`. Write the claims under [[17283aea]]; the module is [[cb732496]].

The union is sixteen kinds and two producers (a stored transcript, a live agent message) that must land on the same list; the handlers are where a product folds its own records in. What a kind means, which producer can make it, and what a renamed or missing wire field reads back as is what a reader cannot infer.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.