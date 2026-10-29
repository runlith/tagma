---
id: 01a10c61-1e17-72d3-b0d5-117293a21200
title: Remote devices
ord: 34
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "remote.ts"
      },
      {
        "at": "tailscale/serve.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "remote",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "."
      ],
      [
        "tailscale/"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
sources:
  - kind: dir
    ref: apps/tagma/server/src/remote
---
The operator drives agents from a phone on any network, and the module is what lets the phone into the server: paired devices and their accounts, one-time pairing codes, account and Origin checks for the remote-access door, device revocation and the state of access itself — whether it is on, whether the door listens, whether it is exposed — plus the app views' own addresses on the node. How the door is exposed to the network is decided by pack behind the `Exposure` contract; the door itself — listener, routes, sockets — is assembled by composition, and who calls is decided by invocation on the module's answer.
