---
id: 01a1645c-0111-70ad-b9c5-09ef1cb7b072
title: Built-in Cursor adapter
ord: 35
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/adapter.ts"
      },
      {
        "at": "src/icon.ts"
      },
      {
        "at": "src/selection.ts"
      },
      {
        "at": "src/harness/cursor.ts"
      },
      {
        "at": "src/runner/run.ts"
      }
    ],
    "id": "@runlith/adapter-cursor",
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
    ref: packages/adapter-cursor
---
Cursor comes to Tagma through this builtin package: key login, the official catalog projection, CLI-account-matched quota reading, and fresh asks, beside the terminal harness with its hook codec, screen and transcript readers and hosted ACP profile. The package ships the private runner that drives the official SDK inside `tagma harness-run`, keeping SDK sessions outside the server and tool execution at Tagma's door. Account storage, catalog refresh and process lifetime stay with their callers.