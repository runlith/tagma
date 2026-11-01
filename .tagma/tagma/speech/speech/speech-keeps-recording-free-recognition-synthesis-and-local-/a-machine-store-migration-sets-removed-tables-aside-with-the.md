---
id: 01a195a8-8142-762e-b9e9-43dc2f8d39a2
title: A machine-store migration sets removed tables aside with their rows, and a module store adopts them after the door
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a195aa-3fd8-7672-9ade-42ddb90c9218",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a1956f-d780-7c1a-8b6f-809c556ba27b
---
Item 8 of [[556ba27b]]. The set-aside runs in `platform/store/open.ts` right before `applyMigration`, on the open connection outside its transaction: ATTACH a temporary file, copy each declared table, DETACH, rename it into `stores/set-aside/<migration>.sqlite`. The migration folder declares the tables beside `heavy.json`. Adoption is a store-owner act like `vacuum`, run after `Maintenance.opened`: it inserts by key and deletes the file after its commit. First prove that a pooled `Store.db.run` ATTACH lands on the writer connection that the following transaction uses.