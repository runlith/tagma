---
id: 01a1180d-2c83-7a2c-884f-0a8c9f0b5fe1
title: Checkout files
ord: 12
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      },
      {
        "at": "contract/wire/"
      },
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "checkout-files",
    "kind": "product",
    "order": [
      [
        "contract/wire/"
      ],
      [
        "contract/service/"
      ],
      [
        "."
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c0d5-c713-75bd-b78b-0583adeeb4ba
  - kind: imports
    to: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
  - kind: imports
    to: 01a0c702-a15a-7740-ab79-497190d97bc9
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bee9-7760-9b13-b9847a70e34e
  - kind: imports
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
  - kind: imports
    to: 01a0fd8b-bef6-746f-b533-19bc00ddf0e5
  - kind: imports
    to: 01a0fd8b-bf10-7a02-a086-916b457e7a6c
  - kind: imports
    to: 01a10326-9d9d-7ddf-8111-37bc50467575
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-files
---
The Tagma operator works with checkout files as in an IDE: a directory tree, a path index for Cmd+P, content search, and a live document that updates itself when an agent edits the file. Any existing readable file or directory path on the server also resolves — a file for read-only viewing — regardless of project; this read never widens the file-write scope. The thread's scratch is visible to the operator as a live list of its folders; where that scratch lies, a port tells the module, not the threads module. The module knows listing, index, search, document cells, saving, the operator's file operations, and Tagma's trash; record lines and their ownership belong to the change record, whose intake every write passes through; the checkout's git state and its watcher belong to workspace, editors and tabs to the app.
