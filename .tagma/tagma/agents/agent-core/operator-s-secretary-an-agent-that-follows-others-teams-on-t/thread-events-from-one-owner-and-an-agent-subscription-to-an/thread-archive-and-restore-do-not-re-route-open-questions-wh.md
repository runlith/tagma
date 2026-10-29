---
id: 01a16506-c0ca-7651-aa2b-0934f2b6b4b7
title: Thread archive and restore do not re-route open questions whose approver is an archived parent
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a164ef-27a7-776d-9e6b-92076e26b62c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a164ef-091c-77ef-bb7c-9ff888b55e10
  - kind: relates
    to: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/approvers.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
---
Thread archive and restore do not re-route open questions whose approver is an archived parent.

The question route (`approverStanding` in `threads/approvers.ts`) gives the operator a child's question with an archived parent. But only `Questions.reroute` recomputes a stored approver, and only interception, grant change, and detach call it. Archive and restore (`ThreadList.setArchived`, `setArchivedMatching`; the `thread-record/shelf.ts` entry) never call it.

Scenarios where the question stays with the archived parent and vanishes from "Attention" even after [[88b55e10]]:
- the operator archives a parent with its subtree and restores only the child, which holds a standalone approval;
- an agent archives an ancestor while its own `spared` line stays live with an open question to the archived parent.

Fix at the archive-change producer. `threads/list` sits below harness, so reroute is called via a lower-module port or event, per e090f46d. Recompute open questions of restored threads and live children of archived ones.
