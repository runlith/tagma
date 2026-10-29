---
id: 01a189a0-4b54-758e-bef7-1061d6fd5286
title: Marketplaces
ord: 5
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "contract/"
      },
      {
        "at": "marketplaces.ts"
      }
    ],
    "id": "marketplaces",
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
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-beeb-7ef2-bff4-d6d3b824564e
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a18921-8504-7058-9d53-62c5e9aa47fc
sources:
  - kind: dir
    ref: apps/tagma/server/src/marketplaces
---
A person finds plugins in the marketplaces their ecosystem publishes instead of knowing each plugin's folder or git URL. The module keeps the marketplaces this machine reads — Anthropic's and OpenAI's registered once as presets, any other added by its git URL or folder — each with Tagma's trust label and a stored revision of its list, fetched only when added or refreshed; it reads a list through the list format adapters composition gives it, names an entry by its marketplace and name, and resolves an entry into a plugin source that the plugins module prepares, previews and installs as a snapshot. Installing, consent and installed state stay the plugins module's; the core names no list format.