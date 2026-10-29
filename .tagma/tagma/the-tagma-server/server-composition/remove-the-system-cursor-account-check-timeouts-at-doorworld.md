---
id: 01a16540-0201-700a-8435-e632bd8e945e
title: Remove the system Cursor/account check timeouts at DoorWorld startup
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16445-0f45-7e65-90dd-ab14b2dc0fc8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16445-90f3-7a0d-9973-f138f314fb57
  - kind: discovered-from
    to: 01a16460-2389-71e3-9086-8d06355f1940
  - kind: waits-on
    to: 01a1652f-84e7-7116-9026-de53d0839f81
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/hostedAccounts.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/protocolCursor.stest.ts
---
The full DoorWorld of the account scenario belongs to the file fixture, or the world startup eats the test's own short window. The shared protocol stand must not unconditionally prepare the Claude account, wait for CLI discovery, and select its default in the Cursor scenario; the stand's consumer sets the specific preparation. Keep the budgets and the existing Claude checks; verify a Cursor birth with account A under default B via the HTTP create_thread the app uses, followed by a real held launch.
