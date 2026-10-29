---
id: 01a13201-e512-7222-b8bc-351e57b5b32c
title: Held commands are selected from command_wait, regardless of command history size
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a131f4-6516-7338-bbc6-44dc18285ad5
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/store/commandRows.ts
    symbol: CommandRows.commandsOwnedBy
---
`command` keeps the admission after completion, while `command_wait` holds only work still held. For sweep a `CROSS JOIN` pins this leading table: the admission lookup goes by execution key with incarnation, owner, project and run-condition checks. Otherwise the planner may pick the history owner-index and check wait for every finished command, paying for history even in an empty sweep and holding the writer for the duration of that read.
