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
      },
      {
        "at": "src/harness/museCode.ts"
      },
      {
        "at": "src/runner/run.ts"
      }
    ],
    "id": "@runlith/adapter-muse"
  }
edges:
  - kind: imports
    to: 01a0c6ef-8083-763c-a499-dea0ffc6963b
  - kind: imports
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: imports
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports
    to: 01a0ca5d-3b72-7529-8b88-94c413756ad0
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
    ref: packages/adapter-muse
---
Muse in Tagma: the API-key provider `muse` over `@runlith/llm` registrations, and the harness provider `muse-code`, whose threads run on a Muse Code subscription through the user's signed-in `muse` CLI. The harness side owns the CLI account reading, the live model catalog from `model/list`, fresh asks on a memory-only host, and the hosted runner that drives one `muse serve` host per thread process over a pinned `@muse-code/sdk`, inside a Muse home Tagma keeps per account. The hosted kit, the tool bridge and the server's thread machinery stay with their owners.
