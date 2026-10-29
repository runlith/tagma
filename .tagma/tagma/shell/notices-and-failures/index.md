---
id: 01a174f2-3d51-75fa-8183-c8b41c9696ea
title: Notices and failures
ord: 47
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-notices",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c6fd-caf6-71b7-ae07-f6ae0e2f2094
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports-tests
    to: 01a0c704-a612-7c4c-9f81-5089acc2829b
  - kind: imports-tests
    to: 01a0c839-17d3-7d06-a00d-69691aee61f4
  - kind: imports-tests
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports-tests
    to: 01a174f2-3d74-74cb-a0f8-1c008f8b93e1
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/notices
---
A feature that needs to tell the operator about a failure or offer an action calls this module: a suggestion with its own action, a failure report into a notice, and a display queue above the page. What broke and what to offer is decided by the caller.
