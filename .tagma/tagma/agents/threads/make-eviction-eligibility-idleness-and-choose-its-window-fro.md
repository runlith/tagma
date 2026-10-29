---
id: 01a0c67a-705b-7b06-8915-95afa21f40db
title: Make eviction eligibility idleness, and choose its window from the measured distribution
ord: 112
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c61d-6e44-7fc6-bbd0-9f49ecd97634",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c673-b2a6-7463-92b5-d8fc9975b667
sources:
  - kind: file
    ref: apps/tagma/server/src/protocol/settings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/eviction.ts
---
Start at `ThreadRollouts.sweep` and `ThreadEviction`: today the sweep selects archived threads past `threads.archivedProjectionDays`, and that gate is what leaves 39% of the store's weight without any clock. Replace the gate with last durable movement, keep every refusal the eviction contract already makes, and let archiving go back to being how a reader arranges a list.

The window is not inherited from the old default: it is chosen from the measured distribution of weight by idleness, which is being taken before this work starts. The setting's own meaning moves with the gate, so its title and description must describe the clock that now runs.

`EVICTIONS_PER_PASS` is 300 against a backlog measured in thousands; whatever it becomes, the change states the drain it is choosing rather than inheriting the number.

Done when a never-archived thread idle past the window rests and reads back whole at the next door that opens it, an archived one is judged by the same clock and by no second rule, and a thread with a standing run or an unprovable rollout is kept with exactly the reason it is kept today.
