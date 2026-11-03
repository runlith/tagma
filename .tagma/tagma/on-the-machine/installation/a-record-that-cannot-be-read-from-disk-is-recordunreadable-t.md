---
id: 01a1a33d-85c0-76e6-bcd8-c2091a3279c4
title: A record that cannot be read from disk is RecordUnreadable too, not a thrown defect
ord: 99
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2ba-87bf-74f8-9ab6-df9927e074bb",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1a2d0-aad0-7d52-9407-4513feffc4ae
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/closure/attempt.ts
---
`textAt` in `closure/attempt.ts` rethrows every read error except absence (EACCES, EIO, EISDIR), so an `attempt.json` without read permission breaks the start in `Trial.arrive` and turns `install-from`'s refusal into a defect. Every read failure but a proven absence becomes `RecordUnreadable` with its cause, once, at the owner; proven red→green through `install-from` and the start with a mode-000 `attempt.json`.