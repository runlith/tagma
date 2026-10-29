---
id: 01a0cb07-cef0-7615-a3ae-440766fb4c59
title: A transaction past the writer budget leaves one console line and nothing durable, though it stalled every other writer
ord: 34
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0ca97-13f4-7e9f-bc7a-210182167fbe
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
---
`reportIfOverBudget` (`apps/tagma/server/src/db/Store.ts:418-441`, the five-second figure as `WRITER_BUDGET_MS` at :416) warns on the process's own console when a transaction held the single writer past the budget; a hold of minutes writes no row, raises no finding and leaves nothing a later session can read, though the one-writer constraint is what this area is written against. Done when a past-budget hold is recorded where a reader of the installation can find it, or the console-only answer is deliberately accepted.