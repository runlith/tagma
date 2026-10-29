---
id: 01a17bb7-cc67-7638-96be-59c39325fff3
title: submit_work refuses lines-held, matching a local variable against a same-named member from another's uncommitted file
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held]: \"address in executions/contract/service/views.ts:39\" and \"host in executions/terminals/lanes.ts:65\", both held by a running peer; the only exits are waiting for that peer or carrying its unfinished files whole.",
    "command": "submit_work paths=[executions/host/custody.ts, executions/terminals/start.ts, executions/terminals/hostTerminals.ts, executions/assembly.ts, composition/testing/executions/hostChange.itest.ts]",
    "expected": "Landing goes through: my lines reference the local `address` (assembly.ts executionsLayer) and local `host` (hostChange.itest.ts), neither imported from the peer files."
  }
---
My changed line in assembly.ts is `installation: address.installation,` (reflowed `makeHostTerminals({...})` call) where `address` is `const address = yield* hostAddress(...)` declared in the same function; in hostChange.itest.ts the moved line `host.connection.direct.state(counter)` uses `const host = Context.get(successor, HostManagement)`. Neither file imports views.ts or lanes.ts symbols on those lines. The peer (terminal-window, 01a17b5c-62ed-7a9b-9894-76c0459aa8a3) is running, so `taking` raises still-running and `whole` would land its unfinished files. Cost: the delivery waits for an unrelated session's landing.
