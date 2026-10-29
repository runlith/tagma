---
id: 01a12c56-9126-7a2a-902e-aaa4ada7eee0
title: Built-in OpenCode Go adapter
ord: 30
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
    "id": "@runlith/adapter-opencode-go"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: packages/adapter-opencode-go
---
OpenCode Go provider declaration (`opencode-go`, API key) in the Tagma registry on top of the `@runlith/llm` registration.
