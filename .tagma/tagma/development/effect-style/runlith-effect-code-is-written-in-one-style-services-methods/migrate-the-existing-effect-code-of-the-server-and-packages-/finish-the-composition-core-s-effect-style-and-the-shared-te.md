---
id: 01a14c18-c833-7d88-b3bd-66ee56a66d23
title: Finish the composition core's Effect style and the shared test fixtures
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae9-7a08-9bb0-ae79b53cb89b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
  - kind: relates
    to: 01a13f2d-638d-74e9-8a14-33acd1cc7192
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition
---
Finish the Effect style of production composition, the module's root tests and the shared composition/testing fixtures; together with d1cc7192, remove the remaining temporary Promise boundaries after migrating the real consumers. The specialized testing/threads, executions, change-record, enforcement, landing, sandbox, speech, checkout-files run separately; the shared fixtures contract changes coherently, with no two API shapes. Proof is zero style remainder in the assigned area, green checks and types, preserved spans, a worked-through Sol review and commits.
