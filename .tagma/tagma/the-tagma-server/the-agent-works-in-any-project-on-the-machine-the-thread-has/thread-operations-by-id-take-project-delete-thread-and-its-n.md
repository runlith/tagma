---
id: 01a13258-53e4-7bab-b4f5-9ab086d117cb
title: "Thread operations by id take project: delete_thread and its neighbors address another project's thread"
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13258-6871-7430-8047-e037527cdf09",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13258-1033-70a1-89fa-2141c7d9b5b3
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: dir
    ref: apps/tagma/server/src/threads/contract/wire/operations
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/threadProjectDoor.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threadDoors.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/operations.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/agents.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/compaction.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/context.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/evidence.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/models.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/project.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/acts.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/reads.ts
---
`delete_thread {threadId}` on a project-25 thread from a project-5 thread refuses `foreign-project` with unblock "read it with project: 25", but the native schema has no `project` field; via `tagma op delete_thread --project fluent` the thread is deleted. The refusal promises a road the door does not have.

Do: every operation addressing an existing thread by id and refusing `foreign-project` declares an explicit place (`Operation.place: true` + `project`, like `list_threads`/`read_thread`), and native, MCP, and CLI serve it identically. Walk all such operations (grep `foreign-project` in `threads/`): delete/archive/continue/stop/rename/pin/move and the rest. The "thread and its home" pair check stays. Where unblock names `project`, the operation takes it.

Done: integration test — `delete_thread` with `project: B` from thread A deletes thread B, without `project` refuses `foreign-project`; the affected operations' schemas carry `project`.
