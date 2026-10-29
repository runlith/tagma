---
id: 01a0de28-cd31-7139-ab26-9cde9ff38dcd
title: The symbol reader reads a name at its shallowest indentation, and reads an optional member
ord: 138
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de1c-54e6-7ce4-b1fd-b22959266d4f",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/readers/regions.ts
    symbol: constructRegion
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/readers/regions.ts
    symbol: isMember
---
Three reflections report the same reader answering the wrong lines: [[4c188e0d]] and [[05d364ea]] a local binding shadowing the member or method it repeats, [[befe43f0]] an optional member (`name?: T`) resolving to nothing at all.

Both were reproduced on the current tree before the change: `session` in `packages/executions/src/ExecutionClient.ts` answered three one-line locals instead of the method at 73, `part` in `packages/layer/src/Snapshot.ts` answered line 49 instead of the member at 16, and `browserEntrypoints` in `packages/package-boundary/src/index.ts` answered nothing.

Done when each of the three resolves to the lines its reflection named, the file-level declaration keeps its precedence over a member of the same name, and the claims of this area state whichever rule was built.