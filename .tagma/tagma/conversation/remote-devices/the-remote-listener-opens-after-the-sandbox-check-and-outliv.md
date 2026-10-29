---
id: 01a123a3-1af0-7e4d-b27c-cca77747ed00
title: The remote listener opens after the sandbox check and outlives the setup flow's scope
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1236e-0adf-7dc2-babd-bb7996c6f53e
sources:
  - kind: file
    ref: apps/tagma/server/src/remote/reach.ts
  - kind: file
    ref: apps/tagma/server/src/remote/tailscale/serve.ts
---
Pack first reports the main door's stored origin, then the sandbox's checked origin or its own refusal; only then does Reach open the listener. Otherwise the first `/health` load could have announced the origin of a port held by someone else's service, or left MCP App views disabled until the next focus. The listener belongs to the attempt's outer Scope, not to the setup flow's Scope: finishing the flow after `ready` does not close the working door.
