---
id: 01a0efd8-5bd1-773f-988d-012d6e9f46c8
title: The agent kernel types its write-scoped faces with their own write-unit parameter, so no caller casts a transaction to a write unit
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0efd8-93fb-796d-901d-d77b577bce3f",
    "status": "done"
  }
---
The kernel has one transaction type `TTx` covering read and write units. `NativeTransitions.readAt` passes a read unit into it, so `TTx` cannot be `WriteUnit`. As a result, callers cast to `WriteUnit` at `placement.born` and at the sandbox's birth and teardown announce sites in `sandbox/.../lease.ts`.

Target: add a second parameter, `TWrite extends TTx`, for the write-scoped faces — `transaction`, `writeAt`, `onThreadBorn` and resource `release` — through `packages/agent` and the server's kernel instantiations (about 45 files).

Done when no `as WriteUnit` / `as Unit` cast of a kernel transaction remains in the tree, the typecheck is clean, and the kernel's conformance suites pass.