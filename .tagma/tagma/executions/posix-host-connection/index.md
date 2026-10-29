---
id: 01a12880-2e3b-7b5b-826f-7192e9de12e3
title: POSIX host connection
ord: 41
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "endpoint.ts"
      }
    ],
    "id": "execution-posix-connection"
  }
edges:
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
sources:
  - kind: dir
    ref: packages/executions/src/posix
  - kind: file
    ref: packages/executions/src/executionSpawner.itest.ts
  - kind: file
    ref: packages/executions/src/WireSession.itest.ts
---
The POSIX client opens the registered Unix socket through the `EndpointConnection` port; the endpoint's location and refusing an alien transport belong to the adapter, while authentication and the wire belong to the shared client.
