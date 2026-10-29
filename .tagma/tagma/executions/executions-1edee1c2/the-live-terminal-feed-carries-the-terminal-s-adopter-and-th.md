---
id: 01a15735-2148-79ec-928f-0bca5096cbc2
title: The live terminal feed carries the terminal's adopter, and the client stops polling each terminal every 5 s
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a156f2-58b7-7d3b-a306-b239c921de57
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/worktrees/WorktreeTerminals.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/executions/operations/terminalReads.ts
---
`WorktreeTerminals` reads `record` of every live terminal one by one every 5 s to learn which thread adopted its CLI (`adoptedBy`): the server puts `adoptedBy` only in `read_terminals`/`read_terminal` answers, and the live roster (`CommandActivity.roster`) neither carries it nor reports adoption. To do: the roster carries `adoptedBy` and re-emits the row on adoption and release; the client takes the adopter from the roster and drops the interval. A fresh read stays before close. Proof is the roster owner's event test on adoption and a test that the CLI mark on the tab appears with no polling.
