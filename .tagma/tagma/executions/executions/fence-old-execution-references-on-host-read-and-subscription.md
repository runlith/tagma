---
id: 01a0e917-1129-7737-91a2-e7ebdfb6af19
title: Fence old execution references on host read and subscription verbs before executions M3
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e841-ca11-7a40-8e66-55d3d1aba29c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e8c3-b71d-730a-9c27-889e556fc1a5
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionRegistry.ts
  - kind: file
    ref: packages/execution-host/src/host.ts
  - kind: file
    ref: packages/executions/src/protocol/wire.ts
---
`Processes`, `Listeners`, `Screen` and `Subscribe` still route a wire `ExecutionRef` by execution ID alone. Before executions M3, make their host-side owner preserve and compare installation and incarnation so a ref from an evicted generation cannot read or subscribe to a newer execution that reused its ID. An old or foreign ref must return an honest typed unavailable answer; current references keep their existing reads. Do not block the separate by-key retained-byte or retained-evidence reads, and do not enumerate retired generations. Cover the wrong-generation refusal and current success at the owner; preserve the carried v34 frame shape.