---
id: 01a1488c-954c-76bc-bfcd-42d64103030b
title: Desktop browser host
ord: 30
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "desktop-browser.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "door.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "desktop-browser",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
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
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bf0a-71f6-96fa-2857be68a750
  - kind: imports
    to: 01a0fd8b-bf0c-778a-8cab-a767627a3d25
  - kind: imports
    to: 01a14828-1f15-7e60-8663-f3c1496f9eb4
  - kind: imports
    to: 01a14828-bfa9-7e91-992b-e05c97a922df
  - kind: imports
    to: 01a14a07-3665-70b6-8d89-89ac09510f24
sources:
  - kind: dir
    ref: apps/tagma/server/src/desktop-browser
---
People and agents work with the Tagma window's native pages, but those pages live in Electron main, not in the server. The module is the `desktop` host adapter for the browser module's `PageHost` and `ProfileHost` ports: it holds the `attach_browser_host` feed over which the server sends the host port calls and CDP commands, takes the host's `seq`-ordered report stream, and attaches each generation of the connection to the host registry. Pages, policies and display stay with main (`apps/tagma/desktop/src/browser`); page records and the engine stay with the browser module.
