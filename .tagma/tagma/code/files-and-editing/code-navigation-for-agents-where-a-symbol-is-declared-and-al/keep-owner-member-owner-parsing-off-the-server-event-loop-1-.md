---
id: 01a16617-9edf-76a4-abf9-7eb9282af909
title: "Keep `Owner.member` owner parsing off the server event loop: 1.5–1.9 s over 4.4k `Effect` files"
ord: 44
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16617-c23a-7f62-b082-9ffc31f4faf5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a165e5-cd2c-7831-8362-976a6bb98558
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
sources:
  - kind: file
    ref: packages/navigation/src/owners.ts
---
With [[c195d7ed]] `packages/navigation/src/owners.ts` parses owner-candidate files with code facts (`parseFacet`) synchronously on the server event loop: measurement [[6bb98558]] on runlith is 1.5–1.9 s over 4.4k files of the `Effect` owner with a cold memo; a repeat takes the memo. This breaks rule [[7a910861]]: work that grows with the file count with no upper bound belongs to its owner in a worker or process, not on the loop. While it runs, the server answers nobody — neither the UI nor other agents.

Goal: owner parsing holds the event loop no longer than the rule's threshold at any repository size; cold and repeat question time no worse than now. Where to parse — kit worker, engine process, or otherwise — the implementer decides from the module layout (adapter port, [[e090f46d]]) and measurement.

Acceptance: server event-loop delay (or the process where the question runs) on a cold `uses Effect.fn` on runlith before and after; a test through the public contract only if it catches a return to the loop.
