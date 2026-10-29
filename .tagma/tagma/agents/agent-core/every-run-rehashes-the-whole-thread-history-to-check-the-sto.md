---
id: 01a1401c-e794-71da-b777-0ef664f8bca0
title: Every run rehashes the whole thread history to check the stored measurement base
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13fd0-aafb-7c4c-bb78-cce3611ba91a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd8b0203ef2
sources:
  - kind: file
    ref: packages/agent/src/thread/compaction/ThreadRequestMeter.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadContextAnchor.ts
---
**What:** checking the saved measurement base (`contextReading.footprint`) on a run's first step no longer rehashes the whole thread history.

**Why:** `ThreadContextAnchor` creates a new `ThreadRequestMeter()` per run, its caches are `WeakMap`s over message objects, and a run's history reads from the journal as new objects. The saved footprint carries only a message count and one prefix-digest summary, so `opensOn` and `requestHashed` drive every part of every message through `absorb` (synchronous serialization on the event loop) and sha256. That costs at every run start, and after a server restart at every resumed one at once: the Oct-15 start profile f42a301f shows `absorb` ~285 ms in one window, against 7a910861.

**Where to look:** spec b0203ef2 already names it ("a meter per thread, surviving runs"). The smallest step for the owner is a base verifiable without recompute: a message's digest and cost are computed once when written to the journal and stored with it, or the footprint holds the journal position (last prefix record and compaction generation) and only the tail after it hashes.

**Proved by:** a meter test — the first step of a new run over a long stored history with an acting base handles only messages after the base (a handled-message count, not time).
