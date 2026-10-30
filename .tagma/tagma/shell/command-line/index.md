---
id: 01a0fd8b-bf0c-778a-8cab-a7689e81e75e
title: Command line
ord: 43
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "door.ts"
      },
      {
        "at": "invoke.ts"
      },
      {
        "at": "live.ts"
      },
      {
        "at": "verbs.ts"
      },
      {
        "at": "cli.ts",
        "for": [
          "13182a9f"
        ]
      },
      {
        "at": "mcpTools.ts",
        "for": [
          "9e81e75e",
          "13182a9f"
        ]
      }
    ],
    "id": "cli",
    "kind": "surface"
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
    to: 01a0fd8b-bf07-7e08-a660-42bdab05dfec
  - kind: imports
    to: 01a0fd8b-bf0a-71f6-96fa-2857be68a750
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: apps/tagma/server/src/cli
---
The operator, scripts, and foreign CLIs reach Tagma from the terminal, and the module is that door: the `tagma` and `tagma op` verbs for any operation, connection to the running server, and Tagma operations as MCP tools for a foreign CLI. It holds no operation logic of its own: everything goes to the server through its door.
