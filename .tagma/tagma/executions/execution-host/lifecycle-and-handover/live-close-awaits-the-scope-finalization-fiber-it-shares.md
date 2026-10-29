---
id: 01a1298e-78b2-7a99-86f0-0322aaf0b16f
title: Live close awaits the scope-finalization fiber it shares
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12977-38fa-7133-ae4d-266c6849d1a1
sources:
  - kind: file
    ref: packages/execution-host/src/registry/launch.ts
  - kind: file
    ref: packages/execution-host/src/registry/retention.ts
  - kind: file
    ref: packages/execution-host/src/registry/shutdown.ts
  - kind: symbol
    ref: packages/execution-host/src/registry/state.ts
    symbol: Live
---
Effect 4 marks a scope closed before finalizers run, so a repeated Scope.close never proves their end. Live.close keeps one close Fiber in the registryScope: shutdown, handover to the shelf and retirement join its result, and the caller's budget expiry never stops finalization. What is cached is the Fiber creation, not the close itself: the unfinished-Effect cache allows a fresh start after the last awaiters leave.
