---
id: 01a17aff-0013-783e-93b0-821902ce39c8
title: The window types into the terminal and reads its live output over the lane connection
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ae0-48f6-7cff-9adb-353003be8a0d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
  - kind: waits-on
    to: 01a17aff-0013-783e-93b0-82187374bf6c
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Input.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/RecordStream.svelte.ts
---
`Input` sends acts into the lane connection and reads receipts from it; `RecordStream` reads record history up to the seam and then live output from the same connection. A break reopens the lane and resumes from the cursor and unacked sequences.
