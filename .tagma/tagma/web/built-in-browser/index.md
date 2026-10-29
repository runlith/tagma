---
id: 01a14828-bfa9-7e91-992b-e05c97a922df
title: Built-in browser
ord: 28
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "browser.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "browser",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
      ],
      [
        "store/"
      ],
      [
        "engine/"
      ],
      [
        "doctrine/"
      ],
      [
        "."
      ],
      [
        "testing/"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a14828-1f15-7e60-8663-f3c1496f9eb4
  - kind: imports
    to: 01a14a07-3665-70b6-8d89-89ac09510f24
  - kind: imports-tests
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
  - kind: imports-tests
    to: 01a0fd8b-bf0a-71f6-96fa-2857be68a750
sources:
  - kind: dir
    ref: apps/tagma/server/src/browser
---
People, agents, and plugins work with the same browser pages, and the module owns them: the project's page records and the machine's profile records, live page state from host events, the registry of connected hosts, the automation and broadcast engine over one CDP session per page, and the feed operations through which agents, the client, and plugin processes call it. Live pages are held by host adapters — separate modules behind the `PageHost` and `ProfileHost` ports, which declare and connect themselves to the registry; the CDP protocol and primitives come from the `@runlith/cdp` kit, and page display stays with the client.
