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
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
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
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
  - kind: imports-tests
    to: 01a1239f-2e01-7962-8ca3-25a8af373f07
  - kind: imports-tests
    to: 01a1adb5-4e03-7f9b-b329-e56dc7b772e2
sources:
  - kind: dir
    ref: apps/tagma/server/src/views
---
A plugin view draws in Tagma what its process holds: a tool result in the feed, a pin above the feed, a project section, a side pane, a window opened from the palette and the rail. The module declares the `views`, `results`, `surfaces`, `panes`, `launchers`, `actions` and `shortcuts` points, hands the client the checked views of the plugins enabled in the project, and executes what a view asks of the host: a `view`-audience tool call, a process-resource read and subscription, view key-value storage in the plugin's data directory. It also lists, machine-wide, the actions and proposed chords of every published plugin (`views.actions`) and runs an action for the operator in a project (`run_plugin_action`). Mounting, bridge and isolation are held by the client; the process and its life belong to `plugin-host`.