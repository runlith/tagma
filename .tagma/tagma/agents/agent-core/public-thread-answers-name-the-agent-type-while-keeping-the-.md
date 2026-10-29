---
id: 01a14b4f-3ea7-760e-ba66-398c85970722
title: Public thread answers name the agent type while keeping the base type for execution
ord: 63
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14b4e-8d6d-7415-81b8-1fa003da4c61",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14b4c-ecfe-7d12-b8fb-781fde1f806e
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/threadTypeDoor.stest.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/wire.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/directory.ts
  - kind: file
    ref: packages/agent/src/collaboration/births.ts
  - kind: file
    ref: packages/agent/src/collaboration/native/record.ts
  - kind: file
    ref: packages/agent/src/collaboration/native/threads.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadDirectory.test.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadDirectory.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadEnvelopes.test.ts
  - kind: file
    ref: packages/agent/src/collaboration/threads.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadSpawnBirth.test.ts
  - kind: file
    ref: packages/agent/src/protocol/http.ts
  - kind: file
    ref: packages/agent/src/thread/agents/AgentProfile.ts
---
Fixed [[de1f806e|the lost declared type in public answers]]: the saved profile already held its own identity, and the line's agentId stays the key of the base definition for execution. One type output feeds spawn and its repeat, a directory with SQL extraction of only the profile id, the serialized snapshot, the read_thread shape, and the list facts; compaction gets the base key. Code: `19ac99a3bc`, SQL-projection refinement `5eec435bf9`. Checks: 24 spawn/directory unit tests, 72 envelope tests, and 5 HTTP system tests passed; the original reader-instead-of-tagma expectation first reproduced the defect. `bun run tagma:typecheck` passed; a single independent Sol xhigh review of the whole delivery found no defects in this part. The reflection is answered by the commit. The running server was not restarted; live answers change once the operator loads the new code, with no migration and no rebirth of existing threads. No real model call was checked.
