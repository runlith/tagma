---
id: 01a194a5-7e9e-7e3e-8cf5-fb87d13ee0a0
title: A running hosted run holds one bounded copy of its history and nothing per step past that step
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19472-8e6b-7d29-8c7d-8b57bd55cb0a",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19471-c11f-7184-8092-d9c0a990be94
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
  - kind: relates
    to: 01a1949a-5e28-73f2-af6e-8062389d12ed
---
A running hosted run should hold one bounded copy of its thread's history and nothing per step past that step. In the a990be94 proof bench the heap after full collection kept growing while the history cache stayed bounded.

Measured on one 12-core 32 GB macOS arm64 machine, Bun 1.4.4, `agentLoad.bench.ts --agents=10 --warm=240 --seconds=300 --rate=4 --message-bytes=300000 --turn-min=20 --turn-max=50`, heap after `gcAndSweep` at the warm and loaded cuts:
- the JS heap went 491 → 653 MB while histories totalled 226.9 MB serialized (largest 32.1 MB);
- by strong-root dominator, ownerless bytes rose 184.6 → 351.1 MB, nearly all of it strings, and `FiberImpl` dominators rose 50.6 → 81.6 MB, about 18–21 MB per running thread;
- in Map storage, four hosted assemblies (`{active,agentId,callGuides,calls,…,history,journal,…}`) held 18.5 MB at the warm cut;
- `HeldHistories` exclusively held about 20 MB → 0.04 MB, and no folded `Held` outside it.

The live snapshot `8039e995` shows +58 MB of ownerless strings over 18 minutes; whether it is the same cohort is not established.

Done when the running run's history is one shared copy the history store also serves, nothing per step outlives its step, and over a steady N=10 run with large histories the heap after full collection stays flat except for that declared working set.
