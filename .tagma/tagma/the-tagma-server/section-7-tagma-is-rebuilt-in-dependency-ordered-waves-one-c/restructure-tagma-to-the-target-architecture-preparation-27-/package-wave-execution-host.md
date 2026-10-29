---
id: 01a0e569-e6be-7003-9e06-b654be92a23f
title: "Package wave: execution-host"
ord: 58
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e9c3-5234-74ec-b21f-4fd941d87513",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-f876-7433-b54b-0ba8e4a0488f
---
The `execution-host` card of section 7 part 2 ([[e4a0488f]]), with its vocabulary amendment [[1deb33b8]]. Owns this package's `modules` and `names` debt. Its order and waits-on edges follow section 6 ([[be799808]]) and are added with the package groups' schedule.

Before `held-resources` reaches gate, remove both unjudged bare/nested Map constructions: `ExecutionRecord.ts` passes `new Map()` to `withOpen` near line 496; `Presentation.ts` assigns `bucket = new Map()` near line 1042. Preserve their value types in the producer or extend contextual type facts, and prove both sites judged.

Code landed on `restructure` through `59c00a7d94` (registry subject contracts, record class and consumers) after earlier package cuts. Package typecheck exited 0, 312/312 unit tests passed, `modules`/`names` reported zero new violations and both Map sites were judged with zero unjudged. Remaining acceptance evidence, tracked at merge: run the host integration/system compatibility suites under the wave's explicit prohibition on running them here and reconcile the moved claims listed in [[4a9013bf]] against main. No host package tree changes remain held by this session.