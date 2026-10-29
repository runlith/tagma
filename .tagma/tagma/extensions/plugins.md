---
id: 01a18921-8504-7058-9d53-62c5e9aa47fc
title: Plugins
ord: 47
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "plugins.ts"
      },
      {
        "at": "servers.ts"
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "plugins",
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
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
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
    to: 01a0fd8b-befe-744b-876f-36f2f3b6b585
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a1239f-2e01-7962-8ca3-25a8af373f07
sources:
  - kind: dir
    ref: apps/tagma/server/src/plugins
---
The agent works with a plugin written for the agent ecosystem — Agent Plugins 1.0 or Claude Code — installed unchanged from a folder or a git URL. The module owns installing it on the machine and enabling it per project, reading a directory through the format adapters composition gives it, the `<plugin>-<name>` names of its components and their collisions, the consent its MCP servers and hooks raise, its options (secret ones under its own owner kind of the key store), and the reading of each enabled plugin bound to a project that native-harness and the MCP pool take. What a format means is its adapter's; the core names none.