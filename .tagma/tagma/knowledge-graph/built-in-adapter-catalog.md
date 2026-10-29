---
id: 01a12ce3-7d6d-71b9-8c1e-d661ac293dd5
title: Built-in adapter catalog
ord: 46
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/descriptions.ts"
      },
      {
        "at": "src/registrations.ts"
      },
      {
        "at": "src/subscription/"
      }
    ],
    "id": "@runlith/builtin-catalog"
  }
edges:
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a12c56-911b-7d6f-9ef3-3bc7b6853ec2
  - kind: imports
    to: 01a12c56-911d-7f8b-ade2-75bbc432f43a
  - kind: imports
    to: 01a12c56-911f-76ad-b665-0ff9a95d3d64
  - kind: imports
    to: 01a12c56-9122-7c94-91a6-f1c2cc11b67b
  - kind: imports
    to: 01a12c56-9124-7319-834e-660cd644f1c5
  - kind: imports
    to: 01a12c56-9126-7a2a-902e-aaa4ada7eee0
  - kind: imports
    to: 01a12c56-9127-7a6c-ac2f-3e1937fe1c9a
  - kind: imports
    to: 01a12c56-9129-7fb3-aa86-19579bcbb761
  - kind: imports-tests
    to: 01a0fd8b-bf14-78e1-9fb7-466fe707d6ca
  - kind: imports-tests
    to: 01a123cc-eedf-7059-b425-43b31ad089ea
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/builtin-catalog
---
Descriptions and recorded registrations of all built-in adapters together — for core, server and client tests that need a real provider catalog — and for checking the shared `@runlith/llm` machinery (credential store, sign-in, catalog, protocols) against real adapters. The core knows nothing about vendors, so these checks live here, above the adapters.
