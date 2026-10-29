---
id: 01a111ab-9639-7730-81d5-59311ee0244c
title: "The edit-version store grows unbounded: 3,975 MiB in three weeks"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11240-8e4d-73c7-bcd8-d90d8bc83db1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a111ab-9639-7730-81d5-593018d06fb3
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/store/tables.ts
---
The `workspace_change_content` version store only grows: one insert writes it (`change-record/record/write.ts:31`), and nothing deletes. On 2026-10-06 it holds 151,056 versions, 3,975 MiB, since 2026-09-14. After [[18d06fb3]], commands will add about 1,400 shifted paths a day.

Decide which versions must live — texts of uncommitted edits, chain bases, everything a rewind needs — and collect the rest. Collection plugs into whatever invokes it by the same change ([[a00f91b0|the act with a driver]]).

Done when the store size is bounded by uncommitted work and what a rewind may roll back, not by the whole edit history.
