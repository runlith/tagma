---
id: 01a0de22-e67f-79ea-88fe-3ac337946be3
title: Bound rollout disagreement reads without waking rested threads
ord: 18
tags: ["task"]
fields:
  {
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/harness/ThreadRollouts.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/report.ts
---
Read the stored projection refusal and at most the requested plain-file records without hydrating a rested conversation. A compressed file must be named truthfully and left unopened; no refusal is evidence only that none was recorded. Finish after a rested-thread red/green check, relevant integration tests, typecheck assessment and an aimed doctor pass.