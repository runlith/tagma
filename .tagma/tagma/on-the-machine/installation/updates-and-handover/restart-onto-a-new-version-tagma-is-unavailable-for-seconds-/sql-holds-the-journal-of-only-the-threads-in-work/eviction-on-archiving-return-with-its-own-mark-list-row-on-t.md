---
id: 01a126b9-6a5d-780b-8049-4224d802b89f
title: Eviction on archiving, return with its own mark, list row on the thread, and history deletion with the thread
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1267b-9010-7ed8-ab9d-f3fd930f4d29",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79efc3af42eb
  - kind: waits-on
    to: 01a126b9-6a5d-780b-8049-42210911272b
---
First step is the database broken down by table and index on a file copy. Then: an archived thread is evicted by a separate act right after archiving and after reading; the idle pass starts after run recovery and yields to human work; the return marks itself; the list row is stored on the thread; and history is deleted with the thread, service accounting with the end of the work. Start at `threads/journal/rolloutEviction.ts`, `rest.ts`, `replay.ts`. Done when the spec's checks pass.
