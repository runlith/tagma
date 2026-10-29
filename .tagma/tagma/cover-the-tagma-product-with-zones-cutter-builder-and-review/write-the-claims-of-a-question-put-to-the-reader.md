---
id: 01a0ca5e-42b8-73ce-af59-4bfcf29587c9
title: Write the claims of a question put to the reader
ord: 160
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
Read `packages/chat-ui/src/entries/QuestionRow.svelte`, `ToolConfirmation.svelte`, `UserQuestion.svelte`, `PendingInputDock.svelte`, and the confirmation helpers in `entries.ts`. Write the claims under [[b703274b]]; the module is [[cb732496]].

What is claimable: what makes a question read as a confirmation rather than as an agent asking a person — it is the prompts it carries, never where the row sits — and what the surface decides about where it lands. The protocol shape itself is the kernel's [[d1caad35]]; claim here only what this package decides about it.

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. This is Svelte 5: load the `svelte5` skill first. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.