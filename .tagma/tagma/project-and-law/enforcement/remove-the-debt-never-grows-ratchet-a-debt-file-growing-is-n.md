---
id: 01a11707-a337-71f5-9c02-2dab5fa537e1
title: "Remove the \"debt never grows\" ratchet: a debt file growing is not a violation, it is a debt measurement"
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11706-8d05-7355-9b44-df65c9f43d65",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0f01d-9a06-78da-87fc-8eef6b3210c7
---
A file in debt is a known violation with a task owner; its growth is no new violation and the gate doesn't refuse it. Only a new violation refuses (a file crossing the limit for the first time). Growth is recorded in the debt measurement (the record's value updates at measurement, not only downward).

Why: the ban on growth forced agents to fit the file to the number instead of solving the architecture (View.svelte.ts refused 5 times, 1349→1356→1208→1211→1208).

Where: value comparison in `apps/tagma/inspection/src/core/verdict.ts` and `core/node/judge.ts`, value lowering in `apps/tagma/server/src/enforcement/rules/enforce.ts`, `remeasure/rule.ts`, `lineage.ts`, `commits/graphMerge.ts`; texts in `packs/architecture/size`, `names` and rule 6b3210c7.

Proof: contract tests — a grown debt file doesn't refuse, a new file past the limit does; typecheck of affected packages.
