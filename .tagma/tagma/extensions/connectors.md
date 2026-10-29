---
id: 01a18895-c4d0-788c-9b73-3b1f94035751
title: Connectors
ord: 46
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "connectors.ts"
      },
      {
        "at": "contract/"
      },
      {
        "at": "shipped.ts"
      }
    ],
    "id": "connectors",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-befe-744b-876f-36f2f3b6b585
sources:
  - kind: dir
    ref: apps/tagma/server/src/connectors
---
A person connects a service an agent should reach on their behalf in one act instead of assembling an MCP declaration by hand. The module owns the catalog of such services — data of one shape read through one port, shipped inside Tagma so it works offline and with no account — and the operator's connect and disconnect, which declare and remove an ordinary MCP server carrying the connector's mark and start its sign-in. Everything after the declaration — sessions, tools, sign-in, refresh, values, redaction — stays with the MCP servers module, and a connector's state is read from that server's row.