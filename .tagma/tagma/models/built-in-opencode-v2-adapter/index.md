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
        "at": "src/harness/opencode.ts"
      },
      {
        "at": "src/harness/session.ts"
      },
      {
        "at": "src/runner/run.ts"
      }
    ],
    "id": "@runlith/adapter-opencode",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c6ef-8083-763c-a499-dea0ffc6963b
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a108bd-5060-7141-819c-dd4dad88de8a
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a18e33-3513-785d-9824-df6d3c2426a1
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/adapter-opencode
---
OpenCode comes to Tagma through this builtin package: its profiles and model catalog keep upstream credentials in OpenCode, its terminal surface binds the standalone CLI through the plugin and hook vocabulary, and its hosted ACP profile ships the private client runner that takes Tagma's prompt and tools. The package owns the official CLI host and profile environment; account selection, catalog refresh and the thread journal remain with the callers.