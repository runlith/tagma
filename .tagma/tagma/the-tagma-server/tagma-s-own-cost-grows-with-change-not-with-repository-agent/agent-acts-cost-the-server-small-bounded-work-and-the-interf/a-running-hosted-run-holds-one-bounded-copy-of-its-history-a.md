---
id: 01a194a5-7e9e-7e3e-8cf5-fb87d13ee0a0
title: A running hosted run holds one bounded copy of its history and nothing per step past that step
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19472-8e6b-7d29-8c7d-8b57bd55cb0a",
    "status": "done"
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


## Outcome (`f1ff9abc16`, `5b400140c9`)

**What held the growth.** Large strings in the `--rate=4` snapshots, grouped by retainer chain and by message `id`, showed about 1.5 distinct copies of each message across the ten threads, each copy with its own text strings. They were fresh parses, not shared objects. A load and rewrite probe (temporary, removed) found where they came from, at 180 s of the same bench:
- 102 cold whole-history loads in `call_hosted_tool` reads: a write's claim replaced the cached entry with an empty one, so every read during an in-flight write parsed the whole history again;
- 20 whole-row rewrites at `open_hosted_turn`: the write unit loaded a fresh copy, shared no identity with the run's history, and deleted and reinserted every row;
- holders that kept those copies alive: `Worlds` (full thread rows in the cached world's closures), tool-call contexts and tool options (`messages`) while their call stood.

**Fix.** A claim keeps the committed history readable and readers cannot publish over it. Threads this process drives (`RunControl` through `harness.runs.driven()`, served to `HeldHistories` with `serveDriven`) are never evicted, and the bound is checked again whenever the driven count changes. `Worlds.of` keeps only the thread fields it declares. The program-keyed transition snapshot and the journal's planned and carried batches are released at unit end ([[ac751462]], [[cd6c3a69]]).

**After** (same machine, same `--agents=10 --warm=240 --seconds=300 --rate=4 --message-bytes=300000 --turn-min=20 --turn-max=50`):
- the probe found 7 cold `call_hosted_tool` loads and no whole rewrites over 2,741 fold writes (949,298 rows kept, 5,286 written); completed calls by the loaded cut rose 748 → 1,285;
- about one copy of each message (≈10 objects per id across ten threads);
- JS heap after full collection went 409 → 737 MB while serialized history grew to 392.5 MB; large strings grew 177 → 483 MB, so all but ~22 MB of the heap growth is the message text of the running histories, one copy each — the declared working set.

Open: run-scoped holders that keep a full thread view for the run (`turns/context.ts` preparation, `turns/runWebs.ts` vendor memory) share message identity during append-only work; their exclusive retention after compaction or pruning is unmeasured.

Not checked: whether the +58 MB of ownerless strings in live snapshot `8039e995` is the same cohort of duplicate history copies; the bench evidence suggests it, the live snapshot was not regrouped by message identity.
