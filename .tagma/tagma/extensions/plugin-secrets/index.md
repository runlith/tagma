---
id: 01a1239f-2e01-7962-8ca3-25a8af373f07
title: Plugin secrets
ord: 30
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "plugin-secrets.ts"
      }
    ],
    "id": "plugin-secrets",
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
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a1231f-29af-74c6-9e71-e4a62243eda2
  - kind: imports
    to: 01a123cc-eedf-7059-b425-43b31ad089ea
  - kind: imports-tests
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
sources:
  - kind: dir
    ref: apps/tagma/server/src/plugin-secrets
---
Plugins need keys and tokens that belong neither in `plugin.json` nor in the graph. The module declares the `secrets` point (each secret's name and description), stores the values the operator enters in the plugin's settings, hands them to the process in env at startup, and registers them in its session's redactor so the value never leaks into feeds, tool answers, or refusal reasons. The process, its startup and restart are the `plugins` module's; this module only owns what goes into the environment and when it changed.
