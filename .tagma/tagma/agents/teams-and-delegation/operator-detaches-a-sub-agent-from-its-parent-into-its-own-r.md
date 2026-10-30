---
id: 01a14bae-6720-7d62-897a-928951e208b5
title: Operator detaches a sub-agent from its parent into its own root and returns it back
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9292bfecd8d9
  - kind: supersedes
    to: 01a14b6d-b237-7cab-99f6-1b18e7ee808a
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/detach.ts
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/detachment.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/routes.ts
    symbol: ROUTE_OPERATIONS
---
**Value.** The operator takes a sub-agent whose work outgrew its assignment into a standalone thread and optionally returns it.

**How.** The list-row menu with undo; the `detach_thread` operation — operator only.

**Behaviour.** The thread with its subtree becomes a root beside its former visible tree in that tree's current folder, including nested folders; an archived ancestor does not supply its placement. A folder belongs to one project, so detachment never carries it into another home project. Detaching from a filed, unpinned tree releases the child's pin so the new root stays in the folder. The former team's assignments to it close with no answer, and further delegation follows its own switch or the machine's. Nobody is woken: the thread and the former parent learn on the next step or in the next run. Returning puts the thread under its former parent at any depth and clears its independent folder placement.

**Limits.** A workflow member cannot be detached. No return under an archived parent or when the name is taken in that team.
