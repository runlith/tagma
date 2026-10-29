---
id: 01a12977-38fa-7133-ae4d-266c6849d1a1
title: A repeated shutdown awaits one execution finalization's end
ord: 8
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4ec70308b97d
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: packages/execution-host/src/registry/retention.ts
  - kind: file
    ref: packages/execution-host/src/registry/shutdown.ts
  - kind: file
    ref: packages/execution-host/src/registry/state.ts
---
Fix the review-confirmed defect at the execution-close owner: shutdown, shelf transfer and retirement join one final scope close. The check holds the finalizer, gets the first shutdown's expiry and proves the repeated shutdown never answers Complete before finalization ends. Return the concrete-first-words check in pending inbox to terminalDelivery after the refusal's event wait. Done: checks passed, changes landed, the unverified named.
