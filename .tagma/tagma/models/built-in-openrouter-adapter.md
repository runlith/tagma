---
id: 01a1647b-1f0b-7495-8de8-0f0d845e4264
title: Built-in OpenRouter adapter
ord: 36
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts"
      }
    ],
    "id": "@runlith/adapter-openrouter"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/adapter-openrouter
---
Under one OpenRouter key, Tagma gets the decision models of its catalog: the adapter reads the model catalog with the `decisions` output and answers decisions with their native call — the OpenRouter Decisions API, whose shared protocol lives in `@runlith/llm`. Model selection and decision recording stay with the server.
