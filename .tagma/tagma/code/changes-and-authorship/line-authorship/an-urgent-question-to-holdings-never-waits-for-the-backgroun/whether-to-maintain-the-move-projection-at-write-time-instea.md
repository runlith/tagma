---
id: 01a14c4e-7d20-7f6a-b9ef-01da6a262691
title: Whether to maintain the move projection at write time instead of recomputing it in every Holdings probe
ord: 5
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Whether to maintain the move projection at write time instead of recomputing it in every Holdings probe.

In the measurement, `ChangeRecord.sessionMoves` took 4.0 s of a 4.7 s large-batch probe: three SQL queries over `workspace_change`. The move projection ([[04065d19]]) is recomputed in every probe for new paths (those missing from HEAD), and a pair depends on the lines of other paths of the same holder.

**Question.** Whether to maintain the projection at write time (intake, command windows, retirement) rather than recompute it from history in every probe.

**What decides.** The cost of `sessionMoves` after [[49c55a3e]] and [[23424bc6]]: with slices capped at 256 paths and no full re-judges after landing it may become unnoticeable. When the probe still spends a visible share on moves, the projection moves to write time.
