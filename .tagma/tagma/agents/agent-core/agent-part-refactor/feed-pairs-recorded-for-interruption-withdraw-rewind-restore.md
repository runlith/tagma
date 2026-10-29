---
id: 01a11b66-715b-73c6-8016-40f31d419d4f
title: Feed pairs recorded for interruption, withdraw, rewind, restore, and reconnect
ord: 33
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11b53-c764-722c-bad6-cc75521d8256
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd5c3436715
---
The remainder of acceptance criterion 3 of [[c3436715]]. The `apps/tagma/server/src/threads/contract/wire/feedPairs/` pairs recorded from a real `thread.subscribe` currently cover the empty stream, bounded/resume, refused, pending, and product kinds. Five shapes are missing: run interruption, withdraw, rewind, restore, and reconnect.

To do: record these five pairs with the same recorder that writes `feedPairs.itest.ts`, and check them with the same itest: events fold into their producer's own rows, and the files do not drift from a fresh recording. After that the kit's equivalence test moves onto these pairs and deletes its handwritten scenarios; the chat-audit team does that step.

Proof: `feedPairs.itest.ts` passes on these five shapes too.
