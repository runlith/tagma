---
id: 01a1516d-12ce-72ee-9660-45cb7686017c
title: "The thread snapshot stands on the journal's exact head position: when the head shifts it is read again inside the write unit where the journal stands still"
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1516d-042d-7f8f-874d-651e937be631
  - kind: relates
    to: 01a13635-e91a-7a7a-94ed-26ec59b927cd
sources:
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
    symbol: makeThreadSnapshots
---
A thread snapshot (`snapshot`, `attachFrom`) must yield the state, the feed page, and the live tail at one journal position: the feed goes on in frames from that position, and the client applies every entry after it exactly once. Applying entries over a later state is not identical (a rewind mark, replayed over an entry that arrived after it, stays on it), so the position must be exact, not a lower bound.

The `atCut` lock is held only by the run recorder and ACP; other journal writers (inbox transitions, child reports, run ends, tool settlement) do not take it. So the first read goes without a write, and when the journal head shifted meanwhile, the read repeats once inside the storage write unit: while it stands open, no writer commits the journal, and the repeat cannot diverge from it. There is no "thread changed during the read" refusal.

The cost is the storage write held for one snapshot read, and only on repeat (in the span snapshot — `writersHeld`). The thread-journal lock (`thread-journal`) does not serve here: some transitions write the journal into someone else's write unit past it, and publication from journal steps takes `atCut` already under it, with the lock order reversed. Order: `ThreadResidence.reading` → `atCut` → write unit. Residence rolls out the unloaded thread in advance and holds `using` until the read ends: otherwise an unload between the first read and the repeat would force the repeat to open the compressed rollout through the `thread-journal` lane under a held writer, and `Lane.enter` would die with `WaitUnderHold`. `atCut` → write unit matches the recorder and ACP; code holding a write unit and awaiting `atCut` would make a mutual wait.
