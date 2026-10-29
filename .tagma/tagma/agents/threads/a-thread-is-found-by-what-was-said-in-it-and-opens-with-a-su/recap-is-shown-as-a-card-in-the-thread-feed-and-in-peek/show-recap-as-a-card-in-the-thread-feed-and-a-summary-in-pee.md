---
id: 01a1031e-d5ce-7656-be01-1b207548771b
title: Show recap as a card in the thread feed and a summary in Peek
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1035e-851a-7e69-a490-30efeec1f119",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff2b-54ff-7f7f-91d2-8f57470336e6
  - kind: waits-on
    to: 01a1031e-d5ce-7656-be01-1b1e232faffc
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/Conversation.svelte
---
Builds [[470336e6]]. UI work — Claude models only.

Start with `apps/tagma/app/src/lib/features/threads/native/Conversation.svelte` and `Peek.svelte`.

Done when the spec's acceptance is met.
