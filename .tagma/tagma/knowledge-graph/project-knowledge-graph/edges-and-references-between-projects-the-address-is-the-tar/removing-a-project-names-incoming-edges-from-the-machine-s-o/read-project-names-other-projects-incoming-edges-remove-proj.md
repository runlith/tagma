---
id: 01a159b0-0c98-7d80-bda9-ae1200f9cdaa
title: read_project names other projects' incoming edges, remove_project with unlink unlinks them
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a159a1-5659-786f-8088-acd20618c9aa",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a159ae-2c87-7eea-be0d-5330aa0ffc24
  - kind: waits-on
    to: 01a159b0-0c98-7d80-bda9-ae10b891b1e3
---
Implements [[aa0ffc24]]: the `pointing` field on `read_project`, `unlink` on `remove_project`, a row and toggle in the app's removal dialog. Proof is the spec's integration test.
