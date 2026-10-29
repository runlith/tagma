---
id: 01a18090-5574-78d6-b5e9-50d1bfbf665a
title: The landing dependency check places member reads by the receiver type across the files the walk reaches
ord: 83
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18081-c193-747f-9800-d762571bfd81",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17d5a-656e-76dc-b53d-177aecccd7e5
  - kind: relates
    to: 01a18087-4820-7e26-9807-02fdfddb6fd3
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/dependencies.ts
---
A member read whose receiver type comes from an import (`failure.message`) linked by name to every peer-added member of that name in any file the root reaches, so `message` added to `CheckoutPaths` refused a landing that read `message` off an unrelated imported type. A name match must be decided by placing the read with a checker over the root and the files the walk reaches; only a read that stays unplaceable keeps linking by name.