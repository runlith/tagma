---
id: 01a19a04-4013-7bb7-8377-aa3beca3d5e3
title: A fork is born with a context reading derived from its source's reading and its cut
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a145ce-8776-7570-a889-5a5420e2428d
sources:
  - kind: file
    ref: packages/agent/src/thread/run/BranchReading.ts
---
A fork is born with the context it carries: its reading is derived at birth from the source's reading and the cut, never left empty until its first own step. A composer meter reads the thread's stored reading, so a fork born without one showed nothing for a history it already holds.

- **Whole copy** (nothing dropped, same prompt) takes the source reading unchanged, footprint included, so the fork's first request anchors on it exactly as the source's next would.
- **A cut** (turns, before a run, a dropped prompt) subtracts what the cut took out: the raw size of the dropped messages the measurement covered, times the thread's own ratio (measured / raw of what the measurement carried). The footprint is dropped, so the reading cannot anchor a prefix the fork no longer has.
- **Nothing carried** (cut `none`) and a source with no reading give no reading; a stale source reading stays as it is — unknown is the honest figure.
- **Limits.** The ratio's denominator holds the source prompt but not its tools, so a cut over-weights the dropped part slightly; tools of a replaced agent stay inside the figure. Restoring a fork from its rollout folds only the journal, which carries no birth reading, so a restored fork shows none until its first measurement.
