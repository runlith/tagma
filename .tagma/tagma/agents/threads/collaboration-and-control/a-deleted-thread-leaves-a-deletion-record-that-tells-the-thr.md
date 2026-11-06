---
id: 01a1adbf-88c9-7bd7-8e49-b5f793e476b1
title: A deleted thread leaves a deletion record that tells the threads addressing it, and is read only when no live thread answers the address
ord: 22
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a10a51-4a3f-7a77-8b6b-fd28e35a759f
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9288c2f9fd4b
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/deletions.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/deletions.ts
---
`ThreadEnding.delete` is the one owner every deletion door reaches, so it writes `thread_deletion` for each member of the deleted tree — owner, team root, name, who, when — before the rows go, and only after the kernel confirms the deletion does it send the child update `deleted`. The line goes to the parent of each member outside the tree and to every outside thread with an open request to a member — the threads that were owed a report. A record written for a deletion that then refused stays harmless: the collaboration plane consults it (`Threads.deleted`) only after `find` and `named` miss, so a live thread or a newer child under the same name always wins, and the newest deletion of a name answers it.

The record exists because the rows are gone: without it an act on the deleted child could only refuse a bare `thread-unknown`, and the parent would invent a cause. The agent package's own store keeps no such record and answers none; the server fills the port from the table.