---
id: 01a190db-f883-7c70-80f5-f23ed6057453
title: The causal ledger omitted statements carried by write programs
ord: 145
tags: ["reflection"]
fields:
  {
    "actual": "The ledger returned standalone statements and program counts but no count for the SQL inside those programs; their response payload was also missing from responseBytes.",
    "command": "CostLedger.read({ limit: 4096 })",
    "expected": "A root's SQL accounting distinguishes standalone Run sends from the statements and guards carried by its submitted programs."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T23:02:50.633Z, from 65684db2.

In the isolated 5× bench, this made the SQL total for hosted reads and ACP saves incomplete after writer-program migration. Before the fix, the real SQLite program regression failed with `Expected: 1; Received: undefined` for a one-statement program. The program submitter already sees the complete statement array and each outcome, so the accounting belongs at that boundary.