---
id: 01a0d028-0e2b-7cbe-afa6-6543269916c8
title: A thread agent acts on another project's threads by naming ?project=, because session operations gate the target against the call's project, never the agent's own
ord: 113
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cfb2-28a5-7420-b105-d4f16c796481",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0cfe5-01c2-7001-8a4b-b581de1d0e99
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/caller.ts
  - kind: symbol
    ref: apps/tagma/server/src/projects/contract/service/caller.ts
    symbol: CurrentProject
---
Found by review of [[de1d0e99]]: a signed agent can run `tagma op <session-operation> --project <other>` — its shell grant rides along — and `CurrentProject` follows the named project, so `gated()` passes for a thread of that project. It holds for every session operation that acts on a thread (`pin_thread`, `archive_thread`, `delete_thread`, `continue_thread`, `refresh_thread_instructions`, `set_thread_delegation` and the rest), not for one of them. Start at the caller's admission in `http/caller.ts` (`operationCaller`, where `actor.projectId` and the served project are both known) and `operations/currentProject.ts`. Decide whether a thread actor may select a project other than its own for writes; if not, refuse there once rather than in each body. Done when that choice is made and holds for the whole family, with a door test.