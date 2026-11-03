---
id: 01a1a34a-0124-7059-85e5-fc29a02e6ab6
title: The captured CLI in tests provides the same native process layer as the real CLI entry
ord: 48
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a341-2637-7144-9259-b92fe2a73661",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1a25c-7026-7f0c-99ee-85be9d866eee
---
`runCli` provides `Processes` and `LockHolders` to every verb since a4dc91e93, but `capturedEffect` — the in-process copy of the CLI entry tests run verbs through — did not. `tagma web` reaching `ensureServer` → `awaitStart` → `readStartup` died with `Service not found: @runlith/execution-host/Processes` before its first health probe, so `ensureServer.itest.ts` setup waited for probes that never came and timed out at 180 s. Both entries take the layer from one `nativeLayer(build)`.