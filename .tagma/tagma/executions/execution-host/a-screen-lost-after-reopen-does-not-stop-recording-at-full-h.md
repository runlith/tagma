---
id: 01a129b6-5d46-7537-9ecb-d40d7b7cbb39
title: A screen lost after reopen does not stop recording at full hold
ord: 15
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4eca5084ccfe
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: packages/execution-host/src/RecordRecovery.itest.ts
---
Confirm the review's record-continuation finding: after reopen the PTY keeps the retention's parsedThrough and awaits parsing; Lost-screen must lift that limit before new output is read. The fix belongs to restoreScreen; verification goes through real reopen and restoreScreen at full retention: the new chunk is written and reads, the screen stays unavailable. Leave parsedThrough and interpreted defaults alone for a working screen.
