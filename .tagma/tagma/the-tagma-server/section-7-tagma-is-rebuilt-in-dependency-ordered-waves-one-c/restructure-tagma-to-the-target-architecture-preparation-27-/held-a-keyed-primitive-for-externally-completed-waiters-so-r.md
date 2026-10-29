---
id: 01a0e9b9-9b49-708d-8dd0-7731d6a03cb0
title: "held: a keyed primitive for externally completed waiters, so reply maps and waiter maps leave `held-resources` debt"
ord: 92
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
---
Nine `Map<key, Deferred>`-shaped waiter lifetimes stand as `held-resources` debt because no `held` primitive fits them. `Flight.join` does not fit: each is completed from outside by a reply, signal or event rather than by work the joiner starts. `AgentToolDoor`'s two retained replay memos instead require a door lifetime and belong to [[f825b4bf]].

The nine entries:
- `packages/performance`: five worker-reply maps, moved here from performance M1 [[126a802a]].
- `packages/agent`: `ThreadChanges` watchers, `ThreadInterruptions` waiters and `ThreadRunLease` `startingRuns`.
- `packages/trace-bundle`: one externally completed worker map, from [[0d728c61]].

The primitive:
- Entries are keyed. An entry is created by a waiter and completed from outside.
- An entry is removed on completion, on the waiter's interruption and on the owning scope's close, so no entry outlives its scope.
- Its size is bounded by the live waiters.
- The `held-resources` inspection recognises it the way it recognises `Held` and `Flight`.

Done when the nine waiter sites use the primitive or a proven existing one, their debt entries retire, and `held`'s unit tests cover completion, waiter interruption and owner-scope close. The two door memos remain owned by [[f825b4bf]].