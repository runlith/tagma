---
id: 01a12c56-9127-7a6c-ac2f-3e1937fe1c9a
title: Built-in StepFun adapter
ord: 31
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
    "id": "@runlith/adapter-stepfun"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
sources:
  - kind: dir
    ref: packages/adapter-stepfun
---
StepFun provider declaration (`stepfun`, API key) in the Tagma registry over the `@runlith/llm` registration.
