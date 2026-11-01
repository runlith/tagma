---
id: 01a19595-c48f-7594-ae00-ef631cc0c227
title: Report the selected graph copy for cross-checkout writes
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19595-3043-740f-9cf7-9474573600a0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a19584-7c83-70ae-ae41-25fc5ac3553b
---
Write answers must identify the graph copy that actually received a named block change, including when a worktree caller reaches a block held only in main. Delivery `245bec8e48`, carried into main by `8c0b44af51`, passed the public native-door provenance regression, reflectWorktree seeds 1–3, 15 graph-crossing cases and typecheck. The subsequent independent review found no regression in the wrapped writes: a retained target-resolution failure is re-raised by targeted.execute before the successful-result decorator can call targetCopy, so the landing's unjudged failure-return path does not convert that failure into success. Cross-project relocation response provenance is a separate pre-existing limitation addressed by [[83c5b282]].