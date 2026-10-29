---
id: 01a1239f-2e01-7962-8ca3-25a8af373f07
title: Secrets
ord: 30
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "secrets.ts"
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "secrets",
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
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a123cc-eedf-7059-b425-43b31ad089ea
sources:
  - kind: dir
    ref: apps/tagma/server/src/secrets
---
Every key or token Tagma hands to a process or a connection — an app's environment, an MCP server's `${NAME}` — belongs neither in settings nor in the graph, so one store holds them all in `secrets.json`. The module keeps the values by owner kind and holder, answers the operator's `read_secrets`, `set_secret` and `remove_secret` without ever answering a value, and hands each owner its values with their masked forms for the redactor. What a kind is, which names it declares and what restarts when a value changes stay with the module that registers the kind; the core names none.