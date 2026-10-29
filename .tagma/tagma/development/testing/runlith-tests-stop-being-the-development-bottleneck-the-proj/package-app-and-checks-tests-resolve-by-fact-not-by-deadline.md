---
id: 01a17a50-d68c-7585-86b0-7c1b067a9b03
title: Package, app, and checks tests resolve by fact, not by deadline
ord: 48
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17a51-b5cc-783c-a12f-c1891a3eb97c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
Scope: `packages/*`, `apps/tagma/{app,inspection,desktop}`, `checks/law`. Explicit test deadlines and `Effect.timeout` waits are replaced with waiting on a fact; a deadline that checks the code's own behaviour (timeouts of execution-host, git, sqlite-process, llm and the like) stays. A file failing in a parallel shuffled run but passing alone is fixed at the root. Acceptance: the area's tests are green on three seeds in parallel, with no deadlines outside the code's own subject.
