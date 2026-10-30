---
id: 01a0c705-58f7-7033-9632-e7dbd4aeec96
title: Input admission means the host took the bytes, not that the child consumed them
ord: 1
tags: ["explanation"]
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
The frontier counts bytes taken but not yet written into the child. What the child did with them is read from the execution's own output.