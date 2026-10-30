---
id: 01a18dbd-ae84-7a7b-8a60-80230cec08e9
title: Model picker names whether a thread follows the default account or holds an explicit one
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d97-bae9-742d-b250-62fe61583ec4",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9280825673b8
  - kind: relates
    to: 01a18dbc-29e3-792e-91b3-fc746d3c7e07
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/PickerHeading.svelte
---
In the existing model picker's provider heading, show a short mode word beside the account name: the thread follows the provider's default account, or holds an explicit one. Account names stay visible; the existing "Follow the default" action stays. UI only; server account semantics unchanged (null follows the default, non-null is explicit). Part of the fix in the parent task.