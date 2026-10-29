---
id: 01a16485-4ad9-7d6b-aece-d0d23f720252
title: Built-in OpenCode V2 adapter
ord: 37
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts"
      },
      {
        "at": "src/host.ts"
      },
      {
        "at": "src/environment.ts"
      },
      {
        "at": "src/selection.ts"
      },
      {
        "at": "src/icon.ts"
      }
    ],
    "id": "@runlith/adapter-opencode",
    "kind": "kit"
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
    ref: packages/adapter-opencode
---
The adapter connects OpenCode profiles and their available models to hosted Tagma threads without migrating upstream credentials. It owns the profile environment, the official entrypoint and status, the directory projection, and a scoped private CLI host with the full client API; account selection, catalog snapshot refresh, and the agent loop stay with the calling owners.
