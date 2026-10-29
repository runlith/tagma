---
id: 01a151a6-efef-713a-9a7a-e004ae5d2ca7
title: Rebuild the Cmd+P index when the external core.excludesFile changes
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151a6-a001-7ba3-be29-65c40ad76bab",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a117dd-98e5-7df2-86cb-e3f89c88344d
sources:
  - kind: symbol
    ref: apps/tagma/server/src/platform/watch/tree.ts
    symbol: watchTree
---
Confirmed: no observation of the external excludes file. watchTree resolves the path through git and holds the parent observation through the shared process; atomic replace, choosing another file, and an empty core.excludesFile move ignore without extending the consumer to any config. The production layer passes configuredGit to listing and index: before, actingGit dropped the user config while the observer saw it. Checked: indexes.itest.ts 5/5, tree.itest.ts 11/11; a separate production-layer contract with an isolated global config reproduced the old defect before the fix and passed after it (1/1). Independent review confirmed the global config divergence; it was fixed in the same pass. Server typecheck reported 12 errors in four foreign files, printed no errors in the changed files; a clean server check is not proved. The running server was not restarted.
