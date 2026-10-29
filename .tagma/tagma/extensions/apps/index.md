---
id: 01a1231f-29af-74c6-9e71-e4a62243eda2
title: Apps
ord: 28
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "plugins.ts"
      }
    ],
    "id": "plugins",
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
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a1239f-2e01-7962-8ca3-25a8af373f07
  - kind: imports
    to: 01a123cc-eedf-7059-b425-43b31ad089ea
sources:
  - kind: dir
    ref: apps/tagma/server/src/tagma-apps
---
The user gets an application inside Tagma with no deploy: a directory with `tagma-app.json` in the project's `.tagma-apps/` or in the data directory's `apps/`. The module owns the manifest envelope, discovery on both floors, the machine installation record and per-project enabling, one app process per machine under its own supervisor, and the contribution-point protocol, while holding the `tools` point itself with audiences. What every other point means — agents, thread ends, views — is declared and registered by its owner; the module hands over the checked declaration and removes it with its disposer.
