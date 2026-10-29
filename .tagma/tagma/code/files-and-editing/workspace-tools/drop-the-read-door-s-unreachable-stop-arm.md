---
id: 01a0ca8f-fb73-7a5f-8671-17a9633b6c7f
title: Drop the read door's unreachable stop arm
ord: 19
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
In `packages/agent-tools/src/read.ts`: (1) is resolved — the directory branch now pages by cursor with a `read(path=…, cursor=…)` continuation, and the "read beyond entry N" wording is gone. (2) still stands: the `ToolFailed('Read stopped without a continuation or an exact total.')` arm (:537) is unreachable — `stopped` is set only where `processLine` returned false, which happens only alongside `more = true`, so `!more && total === undefined` cannot hold. Drop the dead arm, run the package's tests.