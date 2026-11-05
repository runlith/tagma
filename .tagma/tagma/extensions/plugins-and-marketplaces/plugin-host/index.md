---
id: 01a1231f-29af-74c6-9e71-e4a62243eda2
title: Plugin host
ord: 30
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "plugin-host.ts"
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "plugin-host",
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
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bf01-77d4-950b-191990491249
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
  - kind: imports-tests
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports-tests
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports-tests
    to: 01a0fd8b-bf0d-7231-8383-459013182a9f
  - kind: imports-tests
    to: 01a1239f-2e01-7962-8ca3-25a8af373f07
  - kind: imports-tests
    to: 01a18921-8509-7ad6-b9a4-fd45d6ac5676
  - kind: imports-tests
    to: 01a1adb5-4e03-7f9b-b329-e56dc7b772e2
sources:
  - kind: dir
    ref: apps/tagma/server/src/plugin-host
---
A plugin in Tagma's format may run a process that serves its tools over stdio MCP, and this module runs it: one per machine for each installed plugin enabled in at least one project, its contributions published from the manifest the moment it is enabled, its process opened on the first demand, stopped when quiet, kept up when the plugin is resident, replaced after a rebuild or an option change, recovered after a crash and stopped when no project runs the plugin. It holds the `tools` point with its audiences, refuses a process whose tool list differs from its manifest, and answers the process state the plugin's card shows. Installing, enabling and reading a plugin, and the content digests of its files, are `plugins`'; what every other point means is its owner's.