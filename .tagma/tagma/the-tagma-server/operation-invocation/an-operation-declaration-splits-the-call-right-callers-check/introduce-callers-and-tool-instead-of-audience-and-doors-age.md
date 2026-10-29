---
id: 01a1126e-434e-78dd-8c0e-a86cf34aa971
title: Introduce `callers` and `tool` instead of `audience` and `doors.agent`, check `callers` on admission, take the tool off the git-panel buttons
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1126e-6834-75fa-8ac6-e36065fb32c2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1126e-31cc-7226-923d-842ffb3d9202
---
Implemented [[fb3d9202|the split between the call right and the agent tool]]: `callers` is checked for operations and feeds before execution, `tool` separately defines the native/MCP set. Delivered in `dbf1fe99b7` and `2e48de8767`; [[54c5fcd2|the operation-declaration explanation]] updated. A bypass found in `tagma stop` and `tagma compact` was fixed at its owners: the CLI passes session headers over WebSocket, and invocation reads the pinned headers of the upgrade request while keeping `CallDevice`.

Checked: the callers/consent matrix, the registry and the catalog schema, the native/MCP set without the eight git-panel actions, four checkout reads in both sets, CLI trust/bypass, the rules court over `commit_checkout`, and 14 Checkout-app tests. The HTTP check of trust/operator/thread-required/bypass passed; its first full run ended with cleanup refusing over a concurrently changing ActivityStore. The new checks of local and paired remote feeds are not yet confirmed after the lifetime fix of the test client: the rerun stopped at `Export named 'recapsShown' not found` in neighboring work. The full workspace typecheck ran but was not green: errors outside this implementation in native-harness, threads, and the git worker, plus the known `ChatTransport.test.ts:184` error. These checks must be repeated on an agreed working tree.
