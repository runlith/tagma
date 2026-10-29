---
id: 01a0c9a4-cecb-71df-b8ce-479b681993b4
title: The compaction policy's stated ordering of its figures is checked nowhere, though the share beside it is
ord: 133
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/compaction/policy.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadCompaction.ts
    symbol: ThreadCompaction
---
The compaction policy states an ordering its figures must keep: the buffer above the maximum recent count, and that above the minimum. Its own words say the ordering must survive any retune, which is a caller's obligation the code does not check.

One policy figure is validated — the prune protection share, which the owner dies on rather than prune outside the open unit interval. The ordering is not. A host that states a buffer below its maximum recent count, or a minimum above its maximum, is accepted silently, and what follows is a selection arithmetic running on figures that contradict each other rather than a refusal naming the pair.

This is the weaker half of a distinction the zone otherwise keeps carefully: every policy figure belongs to the host, and this package validates one of them. Where a package takes figures it cannot compute itself, the ones it refuses to check are the ones a misconfiguration reaches production through — and a wrong ordering here is not loud, it is a quietly worse cut.

Done when a stated ordering the arithmetic depends on is either refused at the boundary the share is refused at, or the code no longer depends on it — and the claim over the policy figures says which are checked.
