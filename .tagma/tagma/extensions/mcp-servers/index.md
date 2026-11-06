---
id: 01a0fd8b-befe-744b-876f-36f2f3b6b585
title: MCP servers
ord: 26
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "mcp",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c703-263a-7a49-8a3d-0bfdc70821a1
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: imports
    to: 01a0d564-ec47-7645-8756-ec405e1647fa
  - kind: imports
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports
    to: 01a1234b-f246-7286-b7d6-ffd1913a0b97
  - kind: imports
    to: 01a1239f-2e01-7962-8ca3-25a8af373f07
sources:
  - kind: dir
    ref: apps/tagma/server/src/mcp
---
Agents get the tools of external MCP servers, and the module owns their declarations — for the project and for the operator's personal set, with `${NAME}` references instead of secrets — enabling and disabling, and the pool of connected processes. A project may decline the operator's servers: they leave its pool and its rows read `declined`. Servers something enabled in a project contributes, such as a plugin, reach its pool through a port of this module that names no contributor kind; they stand below the declarations, are never edited here, and switch off per project by name. A contributor's own process and views call the tools of the servers it brought through `call_contributed_tool`, under those servers' sign-in. It registers the `mcp` owner kind with the secret store, so a reference resolves from the value set for that server, then from the environment, and a server lacking one reads `needs-value`. It signs an HTTP server in by OAuth: it keeps the sign-in record under the same owner, hands each pool the bearer from it, and answers the sign-in's callback on both doors. A server of an open pool that waits on a sign-in or a value is put before the operator as a notification linking to it, withdrawn once it stops waiting. How the server's tools reach the model turn is decided by the harness.