---
id: 01a174f2-3d6d-78f4-877c-f76c78f56704
title: Checkout
ord: 17
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-checkout",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: imports
    to: 01a0c83f-4f47-72fe-9b6c-cf30e4e55579
  - kind: imports
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bef1-758e-b119-40b1d962023e
  - kind: imports
    to: 01a0fd8b-bef6-746f-b533-19bc00ddf0e5
  - kind: imports
    to: 01a0fd8b-bf03-7ff9-bfe7-eb4fc6922284
  - kind: imports
    to: 01a0fd8b-bf04-7004-acd7-a2029543a701
  - kind: imports
    to: 01a0fd8b-bf0d-7231-8383-459013182a9f
  - kind: imports
    to: 01a1180d-2c83-7a2c-884f-0a8c9f0b5fe1
  - kind: imports
    to: 01a1182a-139a-73e6-8a1a-6afa1dfa3fad
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
    to: 01a174f2-3d5a-7431-8610-6fcfbbff045a
  - kind: imports
    to: 01a174f2-3d69-7e11-b0e3-23748b87c117
  - kind: imports
    to: 01a1845d-33f4-7e77-8a62-df878b7128c3
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a174f2-3d4c-7763-bb7b-749e7b63e87f
  - kind: imports-tests
    to: 01a174f2-3d74-74cb-a0f8-1c008f8b93e1
  - kind: imports-tests
    to: 01a174f2-3d8d-7fa1-bc61-069b96400e93
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/checkout
---
The code workplace of one checkout: file tree, search, editor tabs, diff and markdown preview, per-holder changes, commit and history. Markdown preview arrives through the `MarkdownPreview` port, main-view focus through the `CheckoutScreen` port; composition fills both.
