---
id: 01a1237e-b7b0-70ab-98b0-c0c63d78b068
title: Plugin views
ord: 29
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "views.ts"
      },
      {
        "at": "files.ts"
      }
    ],
    "id": "views",
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
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-befe-744b-876f-36f2f3b6b585
  - kind: imports
    to: 01a1231f-29af-74c6-9e71-e4a62243eda2
  - kind: imports-tests
    to: 01a1239f-2e01-7962-8ca3-25a8af373f07
sources:
  - kind: dir
    ref: apps/tagma/server/src/views
---
A plugin view draws in Tagma what its process holds: a tool result in the feed, a pin above the feed, a project section, a sidebar panel, a window opened from the palette and the rail. The module declares the `views`, `results`, `surfaces`, `panes`, and `launchers` points, hands the client the checked views of the plugins enabled in the project with the plugin origin named by the door, serves the plugin's `ui/` files on that origin, and executes what the view asks of the host: a `view`-audience tool call, process-resource read and subscription, view key-value storage in the plugin data directory. Mounting, bridge, and isolation are held by the client; the process and its life belong to the `plugins` module.
