---
id: 01a14c1d-0ad3-7026-bab5-f3fad86ebbaf
title: Keep the parent's model on spawn with a single reasoning
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c1c-113a-78db-9679-8b50e2504c8d",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationTools.test.ts
  - kind: symbol
    ref: packages/agent/src/collaboration/modelChoice.ts
    symbol: birthModel
---
Fix the model choice at child birth: a single `reasoning` changes the rung while keeping the type-profile model or the parent's; an operator-only inheritance is downgraded with a note in the answer. Root confirmed in `birthModel`: requesting a single rung passed the missing model as `null`, picking the provider default. One public-spawn test reproduced the swap of a non-default model; after the fix all 35 tests of the file pass. `movedModel` already keeps the current model on the same provider and is unchanged. `bun run typecheck` ended with `Found 27 errors in 8 files, checked 787 files` outside the two changed files during a parallel Effect migration; the overall typecheck stays unconfirmed.
