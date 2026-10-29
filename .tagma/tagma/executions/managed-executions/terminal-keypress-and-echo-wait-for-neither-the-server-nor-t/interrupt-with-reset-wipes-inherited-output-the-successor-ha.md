---
id: 01a17b56-eaf2-7ac4-a1f5-391d1b3a8e75
title: Interrupt with reset wipes inherited output the successor hasn't yet re-read from pendingEchoes
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b25-1345-7ccf-82c8-ba112cc40277",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17aff-0013-783e-93b0-8217d7e0445d
  - kind: implements
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
sources:
  - kind: file
    ref: packages/execution-host/src/posix/Descriptor.ts
---
After a logic change, the predecessor stream's unread buffer arrives as the first element of the successor's `pendingEchoes` and stands through `Descriptor.owe` in the same queue as synthetic interrupt echo. A no-flush `Descriptor.interrupt` clears that queue whole, so an interrupt admitted before the successor pump re-read the inherited bytes (a buffer up to `READ_AHEAD_BYTES`, the pump taking `TRANSFER_LIMIT` chunks with yields between them) wipes output already read from pty: it is in neither the record nor the live output. The reset must drop only synthetic echo and keep the inherited output. Found by the [[d7e0445d]] review.
