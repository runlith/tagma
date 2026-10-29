---
id: 01a174f2-3d72-7f4e-ae6d-3460a8639e52
title: Embedded browser
ord: 31
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "app-browser",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0ca95-302a-761c-b835-d02e2f69b0c4
  - kind: imports
    to: 01a0fd8b-bf0d-7231-8383-459013182a9f
  - kind: imports
    to: 01a14828-bfa9-7e91-992b-e05c97a922df
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d44-7a14-9cbf-a66c23e74cc4
  - kind: imports
    to: 01a174f2-3d45-708d-99bc-b9d9a8449383
  - kind: imports
    to: 01a174f2-3d51-75fa-8183-c8b41c9696ea
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d53-77eb-b835-34ca4f0a6d9b
  - kind: imports
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
  - kind: imports
    to: 01a174f2-3d6d-78f4-877c-f76c78f56704
  - kind: imports-tests
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports-tests
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
  - kind: imports-tests
    to: 01a174f2-3d4c-7763-bb7b-749e7b63e87f
  - kind: imports-tests
    to: 01a174f2-3d8d-7fa1-bc61-069b96400e93
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/browser
---
The operator and agents view web pages in the embedded browser: tabs, address bar, screencast frames, zoom and page-element picking for the agent. The picking screen arrives through the `PickScreen` port, which composition fills.
