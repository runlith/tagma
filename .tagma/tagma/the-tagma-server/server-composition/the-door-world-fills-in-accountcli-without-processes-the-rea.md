---
id: 01a17a87-9115-7c59-b86f-ab8a573be375
title: The door world fills in AccountCli without processes; the real CLI tests its adapter
ord: 27
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/doorFixture.ts
  - kind: symbol
    ref: apps/tagma/server/src/composition/runtime.ts
    symbol: makeRuntime
---
Runtime composition takes a ready `AccountCli`; without it the product assembles the real adapter over the installed harnesses and terminals. The door world substitutes a full double: mode availability is set independently of the machine, and attempting an account command or opening login gets a typed refusal. So updating the shared world's accounts can continue across files without launching CLIs from their changing PATH and HOME; real-CLI processes stay the subject of its adapter's tests with a controlled binary.
