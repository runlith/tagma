---
id: 01a136bb-b918-7379-b44f-004335154c9c
title: Stall keeps only the spans running across it, plus their ancestors up to the unit head — not the whole unit or window
ord: 27
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a0daf7-4a8b-74b5-8953-75b9cd95a677
sources:
  - kind: file
    ref: packages/performance/src/TraceSampler.ts
---
Only a unit's own failure or slowness keeps the whole unit; only the hash keeps the whole trace. The rule “a unit open across a stall is kept whole” kept almost every model step with all its `sql.execute`: a step lasts seconds, a stall arrives every tens of seconds, and agent runs produced a third of the hour's recorded spans. `read_performance stall` reads the spans intersecting the stall interval, so the spans themselves are enough for it.

A span that ended before the stall was named is looked up where it is still held: in the open unit, in the open window, or in the evicted window waiting for the next trace deadline. A span open at naming time is marked when it ends: its start is no later than the end of the last named stall. This holds while stalls are named in order, i.e. their ends only grow.

Ancestors are taken from the same unit or window so a span that outlived its parent (fork) is not left without a chain to the unit head; an ancestor in an already decided window is not returned. A span of a unit evicted at the byte boundary before the stall was named is lost.
