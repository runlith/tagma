---
id: 01a1283e-8958-74a1-8174-9b54a9ebfcf1
title: Block creation atomically takes it into work at once
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1283e-4540-7268-90eb-aa591a97fea8",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/birth.ts
---
Add claim to create_block and create to apply_batch through the existing claim owner: one graph unit, the same lifecycle and gates, a typed refusal with unblock for tags without the holder role. Prove state and rollback through public operations, run narrow checks and one review: Sol xhigh and Muse on atomicity/gates.
