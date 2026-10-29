---
id: 01a0ef7f-2c80-77ee-b2b9-80f84fb98cb6
title: "The standing terminals are found by scanning every terminal row ever accepted: `TerminalRows.standing` has no index its `discharged_at IS NULL` filter can use"
ord: 54
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/store/terminalRows.ts
    symbol: TerminalRows
---
Measured on the operator's machine, build c16682333f, 2026-09-29: `TerminalRows.standing` took 1.58–1.61 s per call on a machine-store reader (spans `5952e900d898b28d`, `e511de62acbade37`), because `SELECT * FROM terminal WHERE discharged_at IS NULL` is a full `SCAN terminal` over 241,501 rows to find 1 standing terminal. `terminal_standing_idx` leads with `project_id`, so the filter cannot use it; without `ANALYZE` statistics SQLite does not skip-scan it either. Each call parks a reader for that long.

Do: add an index this read can use — a partial index `ON terminal(discharged_at) WHERE discharged_at IS NULL` keeps it the size of the standing set — through the machine migration chain, and read the plan (`EXPLAIN QUERY PLAN`) to confirm a `SEARCH`.

Proof: the plan reads SEARCH, and the span falls to milliseconds on a store holding the same rows. Running `ANALYZE`/`PRAGMA optimize` instead was measured and rejected for this store: on a clone of the 29 GB machine store, `ANALYZE terminal` alone held a write transaction 12 s and `PRAGMA optimize=0x10002` 68 s.