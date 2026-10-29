---
id: 01a15242-d7fc-7250-ae7e-e6ad84232f86
title: Step request preparation (lower) does not walk the whole thread history
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-a858-74a6-80bc-abc30183c034",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09da716be568
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: packages/agent/src/thread/run/toolPairing.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadContextAnchor.ts
    symbol: makeThreadContextAnchors
---
After [[716be568]] `prepare` and the meter of an ordinary step no longer read messages already seen, but `ThreadContextAnchor.lower` walks everything `prepare` returns before every model request: `outputScope.projectMessages`, `pairedForProvider` (two full passes and an `alreadyPaired` check) and `attachments.hydrate` over all messages. That is also synchronous event-loop work growing with history.

Do: the prepared request is held by the run and extended with the tail while history continues the same by message identity, like the prune index; a full pass only after folding or other divergence.

Done (585c719a9c): `lower` holds the prepared request along message lines, at most two lines (the step request and the answer for capture aside), and for a paired continuation runs only the tail through `projectMessages` and `hydrate` ([[167864f9]]). Test in `ThreadCompactionStep.test.ts`: the next request after an intermediate lower of the answer reads no property of earlier messages or their results. Not proven: identity comparison and copying the prepared array stay linear in references; loaded pictures live until the run ends (within the provider request limit).

Proof: the same counter as in `ThreadCompactionStep.test.ts`, but through `lower`: the second step reads no message already seen.
