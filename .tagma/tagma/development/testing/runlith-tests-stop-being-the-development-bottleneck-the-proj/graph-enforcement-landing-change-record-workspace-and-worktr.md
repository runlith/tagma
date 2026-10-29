---
id: 01a17a50-d68c-7585-86b0-7c1964891532
title: Graph, enforcement, landing, change-record, workspace, and worktree tests resolve on fact, not on timeout
ord: 46
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17a51-b595-7937-95aa-915ba99eb7a5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
Area: `apps/tagma/server/src/{graph,enforcement,landing,change-record,workspace,worktrees,platform}` and `composition/testing/{graph,enforcement,landing,change-record,worktrees,workspace}`, plus `composition/testing/{place,mergeSettlesGraph,subjectPlace,worktreeBranch,Worktree*}.itest.ts`. An explicit test timeout and `Effect.timeout` waits are replaced with waiting on the fact; a timeout that verifies the product's own behavior stays. A file that fails in a parallel shuffled run and passes alone is fixed at the root — shared state, order, an event never waited for. Acceptance: the area's files green on three seeds in parallel with `--no-isolate`, no timeouts outside the product's subject.
