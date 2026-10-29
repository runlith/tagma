---
id: 01a0cada-3a18-7f9a-9f2c-b41d7885ea52
title: foldFinished folds by a child's own-row life only, hiding live work below behind the stub
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/tree.ts
---
`foldFinished` (`threadTree.ts:252-265`) classifies each child by `lifeOfRow(child.row)` — the child's OWN row only — plus a day-old age edge. An idle child with a working grandchild beneath it therefore folds by age: the stub is closed by default, renders only a count with no life signal ("N older"), and the folded children render solely when it opens. The comments promise "a child folds when it is quiet" (`:247`) and the stub holds "quiet" children (`:240-241`), but `isQuiet` means root-idle AND nothing alive below (`:164-166`) — a test the fold never runs. Untested: the fold suites build leaves only.

Mitigations exist (the parent chevron still signals via `lifeBelow`, attention counts include hidden rows, jump opens stubs, filtering opens every fold), so live work is reachable — but the stub genuinely hides a working row behind a "finished agents" control. Consult liveness below (or the existing `isQuiet`) before folding. Claim [[9fd52b92]] states the code truly and stands until the fix lands. Done when a subtree with live work below never folds, with a test pinning the working-grandchild case.