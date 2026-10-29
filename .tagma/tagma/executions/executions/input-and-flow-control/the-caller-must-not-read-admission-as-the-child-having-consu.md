---
id: 01a0c705-58f7-7033-9632-e7dbd4aeec96
title: The caller must not read admission as the child having consumed bytes
ord: 1
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/input.ts
  - kind: file
    ref: packages/executions/src/protocol/inputProfile.ts
  - kind: symbol
    ref: packages/executions/src/protocol/input.ts
    symbol: InputFrontier
  - kind: symbol
    ref: packages/executions/src/protocol/input.ts
    symbol: InputReceipt
---
The frontier counts bytes taken but not yet written into the child; what the child did with them reads from the execution's own output.
