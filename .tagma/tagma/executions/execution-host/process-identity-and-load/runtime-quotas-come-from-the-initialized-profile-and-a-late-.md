---
id: 01a12a32-932b-7f60-9b49-515b3feb6fdb
title: Runtime quotas come from the initialized profile, and a late refusal unregisters
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12a0b-124b-7f2a-bdcd-23000195923b
sources:
  - kind: symbol
    ref: packages/execution-host/src/host.ts
    symbol: loop
  - kind: symbol
    ref: packages/execution-host/src/host.ts
    symbol: serving
---
Kernel/grant ceilings before census fund recovery. Subscription quota and retained EvidenceScans use the post-initialize profile so the bootstrap upper bound never becomes a wire promise or a runtime-cache volume. The native usage backend loads before census; admission and capability announcements start after quotas are set. A late ProfileInvalid recalls the matching registration through its owner: the file never promises a ready endpoint of a rejected logic.
