---
id: 01a12c56-9122-7c94-91a6-f1c2cc11b67b
title: Built-in Muse adapter
ord: 28
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts"
      },
      {
        "at": "src/models/"
      },
      {
        "at": "src/profiles/"
      },
      {
        "at": "src/icon.ts"
      }
    ],
    "id": "@runlith/adapter-muse"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: packages/adapter-muse
---
Muse provider declarations in the Tagma registry: the API key (`muse`) over `@runlith/llm` registrations.
