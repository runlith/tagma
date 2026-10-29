---
id: 01a1835f-573c-7bc8-8582-75323a494ce8
title: A write naming a block from a detached stealth checkout lands in the shared graph instead of refusing detached-checkout
ord: 231
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18391-23a7-7ec2-ab2f-39eef32b8fdd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18330-e17f-7d9c-8b28-1f66f530957b
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/crossing.ts
---
A call from a detached checkout of a stealth project that names a block (`update_block`, `create_block` with `parentId`, any `targeted` op) is placed by `placeOf` in `graph/operations/crossing.ts`, which prefers the project's measured checkout over the caller's: it runs against the main copy, which is writable, so `writableAt` never sees the detached frame. Only writes naming no block (`rewrite_graph_files`, `sync_graph`, `resolve_graph_conflict`) still refuse. Measured in `composition/testing/http/graphFormat.itest.ts`: `update_block` from the detached cwd returned 200 and renamed the block. Since every create now names its parent, the create path no longer refuses either; the test now asserts the guard with `rewrite_graph_files`. Placement must keep the caller's read-only copy when the caller stands in a checkout of the target project, and the test must assert a named write again.